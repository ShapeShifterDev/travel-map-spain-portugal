// Train routes only.
// - Uses the gentler curve settings from planeroutes.js / boatroutes.js
// - Solid base line + overlay of short PERPENDICULAR dashes at regular intervals ("rail ties")
// - Dash/tie density scales with zoom to avoid visual noise when zoomed out
// - Uses a single icon: ./icons/train.svg
// Expects:
// - maplibregl loaded
// - map.js dispatches "travelMap:ready" with { map }
// - icons/train.svg exists
// Notes:
// - Assumes pins are bottom-anchored and pin radii match pins.js styles.
// - Add routes by pushing to `routes` array.

(function () {
  // ---- PIN RADII (must match pins.js CSS) ----
  const R_PRIMARY = 15;    // 30px / 2
  const R_SECONDARY = 9;   // 18px / 2

  // ---- LINE STYLE (adjust these) ----
  const LINE = {
    color: '#2f9e6f',
    width: 3,
    opacity: 0.85
  };

  // ---- CURVE SHAPE (gentler, same as plane/boat) ----
  const CURVE = {
    curvatureFactor: 0.14,
    minPx: 14,
    maxPx: 45,
    segments: 100
  };

  // ---- TRAIN ICON SETTINGS (adjust these) ----
  const TRAIN_ICON = {
    iconSize: 3.0,
    minZoom: 0,                // set to e.g. 8.0 to hide until zoomed in
    iconRotateOffsetDeg: 0,    // adjust if train.svg faces wrong direction
    iconOffsetPx: 12           // perpendicular offset from line at midpoint; sign flips side
  };

  // ---- "TIE" (perpendicular dash) SETTINGS ----
  // These are evaluated in pixels and scaled by zoom using expressions below.
  const TIES = {
    // Spacing between ties along the path (pixels). We will scale this with zoom.
    // Larger => fewer ties.
    spacingPxAtZ2: 120,   // when zoomed out (z~2), fewer ties to avoid noise
    spacingPxAtZ10: 45,   // when zoomed in (z~10), more ties

    // Tie length in pixels (perpendicular to track). Also scaled with zoom.
    lengthPxAtZ2: 6,
    lengthPxAtZ10: 14,

    // Tie thickness (line width). Also scaled with zoom.
    widthAtZ2: 1,
    widthAtZ10: 2,

    opacity: 0.75
  };

  // ---------- Geometry helpers ----------
  function pinCenterScreenPoint(map, lngLat, radiusPx) {
    const p = map.project({ lng: lngLat[0], lat: lngLat[1] });
    return { x: p.x, y: p.y - radiusPx };
  }

  function trimToCircleEdges(map, aLngLat, bLngLat, aRadiusPx, bRadiusPx) {
    const aC = pinCenterScreenPoint(map, aLngLat, aRadiusPx);
    const bC = pinCenterScreenPoint(map, bLngLat, bRadiusPx);

    const dx = bC.x - aC.x;
    const dy = bC.y - aC.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;

    const ux = dx / len;
    const uy = dy / len;

    const aE = { x: aC.x + ux * aRadiusPx, y: aC.y + uy * aRadiusPx };
    const bE = { x: bC.x - ux * bRadiusPx, y: bC.y - uy * bRadiusPx };

    const aLL = map.unproject(aE);
    const bLL = map.unproject(bE);

    return [[aLL.lng, aLL.lat], [bLL.lng, bLL.lat]];
  }

  function curvedLineScreenSpace(map, startLL, endLL, curvatureFactor, minPx, maxPx, segments) {
    const a = map.project({ lng: startLL[0], lat: startLL[1] });
    const b = map.project({ lng: endLL[0], lat: endLL[1] });

    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;

    const curvaturePx = Math.max(minPx, Math.min(maxPx, len * curvatureFactor));

    const px = -dy / len;
    const py = dx / len;

    const c = { x: mx + px * curvaturePx, y: my + py * curvaturePx };

    const coords = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const mt = 1 - t;

      const x = (mt * mt * a.x) + (2 * mt * t * c.x) + (t * t * b.x);
      const y = (mt * mt * a.y) + (2 * mt * t * c.y) + (t * t * b.y);

      const ll = map.unproject({ x, y });
      coords.push([ll.lng, ll.lat]);
    }

    return coords;
  }

  async function loadSvgAsMapImage(map, id, svgUrl, pixelRatio = 2) {
  if (map.hasImage(id)) return;

  const svgText = await fetch(svgUrl, { cache: 'no-store' }).then(r => {
    if (!r.ok) throw new Error(`Failed to load ${svgUrl}: ${r.status}`);
    return r.text();
  });

  const blob = new Blob([svgText], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);

  const img = new Image();
  img.decoding = 'async';
  img.src = url;

  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
  });

  URL.revokeObjectURL(url);

  // Some SVGs report naturalWidth/Height as 0.
  // Rasterize to a canvas with a safe default size.
  const w = (img.naturalWidth && img.naturalWidth > 0) ? img.naturalWidth : 256;
  const h = (img.naturalHeight && img.naturalHeight > 0) ? img.naturalHeight : 256;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  const imageData = ctx.getImageData(0, 0, w, h);

  map.addImage(
    id,
    { width: w, height: h, data: imageData.data },
    { pixelRatio }
  );
}

  // Build train route features: base line + optional icon.
  // Ties are rendered via a line pattern overlay (see layers below).
  function buildTrainRouteFeatures(map, route, routeId) {
    const [startLL, endLL] = trimToCircleEdges(map, route.from, route.to, route.fromRadius, route.toRadius);

    const coords = curvedLineScreenSpace(
      map,
      startLL,
      endLL,
      CURVE.curvatureFactor,
      CURVE.minPx,
      CURVE.maxPx,
      CURVE.segments
    );

    const lineFeature = {
      type: 'Feature',
      properties: { kind: 'train-line', routeId },
      geometry: { type: 'LineString', coordinates: coords }
    };

    if (!route.showIcon) return [lineFeature];

    // Midpoint & local tangent for rotation and offset
    const midI = Math.floor(coords.length / 2);
    const mid = coords[midI];
    const prev = coords[Math.max(0, midI - 1)];
    const next = coords[Math.min(coords.length - 1, midI + 1)];

    const pPrev = map.project({ lng: prev[0], lat: prev[1] });
    const pNext = map.project({ lng: next[0], lat: next[1] });

    const dx = pNext.x - pPrev.x;
    const dy = pNext.y - pPrev.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;

    const angleDeg = Math.atan2(dy, dx) * 180 / Math.PI;

    const nx = -dy / len;
    const ny = dx / len;

    const pMid = map.project({ lng: mid[0], lat: mid[1] });
    const pIcon = { x: pMid.x + nx * route.iconOffsetPx, y: pMid.y + ny * route.iconOffsetPx };
    const iconLL = map.unproject(pIcon);

    const iconFeature = {
      type: 'Feature',
      properties: { kind: 'train-icon', routeId, angle: angleDeg, iconSize: route.iconSize },
      geometry: { type: 'Point', coordinates: [iconLL.lng, iconLL.lat] }
    };

    return [lineFeature, iconFeature];
  }

  // Create a small canvas "tie" pattern and add it as a line pattern image.
  // We then render ties using a second line layer with line-pattern, and control spacing via line-width/zoom.
  function addTiePattern(map) {
  if (map.hasImage('train-tie-pattern')) return;

  const size = 16;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);

  // Centered short "tie" dash
  ctx.strokeStyle = 'rgba(47,158,111,0.95)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(size / 2, 4);
  ctx.lineTo(size / 2, size - 4);
  ctx.stroke();

  const imageData = ctx.getImageData(0, 0, size, size);

  map.addImage(
    'train-tie-pattern',
    { width: size, height: size, data: imageData.data },
    { pixelRatio: 2 }
  );
}

  window.addEventListener('travelMap:ready', async (e) => {
    const map = e.detail.map;

    await loadSvgAsMapImage(map, 'train-icon', './icons/train.svg', 2);
    addTiePattern(map);

    // ---- SOURCE ----
    if (!map.getSource('trainRoutes')) {
      map.addSource('trainRoutes', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
    }

    // ---- LAYERS ----
    // Base solid line
    if (!map.getLayer('train-route-line')) {
      map.addLayer({
        id: 'train-route-line',
        type: 'line',
        source: 'trainRoutes',
        filter: ['==', ['get', 'kind'], 'train-line'],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': LINE.color,
          'line-width': LINE.width,
          'line-opacity': LINE.opacity
        }
      });
    }

    // Tie overlay line-pattern
    // To reduce noise at small zoom, we reduce opacity and increase "effective spacing"
    // by reducing line width (pattern repeats less aggressively) while zoomed out.
    if (!map.getLayer('train-route-ties')) {
      map.addLayer({
        id: 'train-route-ties',
        type: 'line',
        source: 'trainRoutes',
        filter: ['==', ['get', 'kind'], 'train-line'],
        layout: {
          'line-join': 'round',
          'line-cap': 'butt'
        },
        paint: {
          'line-pattern': 'train-tie-pattern',

          // We scale tie thickness (pattern rendering) with zoom
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            2, TIES.widthAtZ2,
            10, TIES.widthAtZ10
          ],

          // Fade ties at low zoom to avoid noise
          'line-opacity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            2, 0.25,
            6, 0.55,
            10, TIES.opacity
          ]
        }
      });
    }

    // Train icon
    if (!map.getLayer('train-route-icon')) {
      map.addLayer({
        id: 'train-route-icon',
        type: 'symbol',
        source: 'trainRoutes',
        filter: ['==', ['get', 'kind'], 'train-icon'],
        minzoom: TRAIN_ICON.minZoom,
        layout: {
          'icon-image': 'train-icon',
          'icon-size': ['get', 'iconSize'],
          'icon-rotation-alignment': 'map',
          'icon-keep-upright': false,
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'icon-rotate': ['+', ['get', 'angle'], TRAIN_ICON.iconRotateOffsetDeg]
        }
      });
    }

    // ---- ROUTE DEFINITIONS ----
    // Add train routes by pushing objects into this array.
    // Format for points: [longitude, latitude]
    const routes = [
      // EXAMPLE:
      // {
      //   id: 'example_train_route',
      //   from: [-79.5199, 8.9824],
      //   to: [-79.3835, 9.0714],
      //   fromRadius: R_PRIMARY,
      //   toRadius: R_SECONDARY,
      //   showIcon: true,
      //
      //   // Optional overrides:
      //   iconSize: TRAIN_ICON.iconSize,
      //   iconOffsetPx: TRAIN_ICON.iconOffsetPx
      // }

      {
         id: 'bcn_to_val',
         from: [2.1686, 41.3874],
         to: [-0.3763, 39.4699],
         fromRadius: R_PRIMARY,
         toRadius: R_PRIMARY,
         showIcon: true,
      }
    ];

    function updateTrainRoutes() {
      const features = [];
      for (const r of routes) {
        const route = {
          ...r,
          showIcon: r.showIcon !== false,
          iconSize: typeof r.iconSize === 'number' ? r.iconSize : TRAIN_ICON.iconSize,
          iconOffsetPx: typeof r.iconOffsetPx === 'number' ? r.iconOffsetPx : TRAIN_ICON.iconOffsetPx
        };
        features.push(...buildTrainRouteFeatures(map, route, route.id));
      }

      map.getSource('trainRoutes').setData({
        type: 'FeatureCollection',
        features
      });
    }

    updateTrainRoutes();
    map.once('idle', updateTrainRoutes);
    map.on('move', updateTrainRoutes);
    map.on('zoom', updateTrainRoutes);
    map.on('resize', updateTrainRoutes);
  });
})();
