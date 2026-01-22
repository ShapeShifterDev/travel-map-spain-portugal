// Boat routes only.
// Similar structure to carroutes.js / busroutes.js, with these differences:
// - Uses the gentler curve settings from planeroutes.js
// - Line is solid, not dashed 
// - Each route can choose an icon: boat.svg or smallboat.svg
// - Same icon adjustment settings apply to both boat icon types
// Expects:
// - maplibregl loaded
// - map.js dispatches "travelMap:ready" with { map }
// - icons/boat.svg and/or icons/smallboat.svg exist
// Notes:
// - Assumes pins are bottom-anchored and pin radii match pins.js styles.
// - Add routes by pushing to `routes` array.

(function () {
  // ---- PIN RADII (must match pins.js CSS) ----
  const R_PRIMARY = 15;    // 30px / 2
  const R_SECONDARY = 9;   // 18px / 2

  // ---- LINE STYLE (solid) ----
  const LINE = {
    color: '#2f9e6f',
    width: 3,
    opacity: 0.85
  };

  // ---- CURVE SHAPE (gentler, same as plane routes) ----
  const CURVE = {
    curvatureFactor: 0.14,
    minPx: 14,
    maxPx: 45,
    segments: 90
  };

  // ---- ICON SETTINGS (applies to ALL boat types) ----
  const BOAT_ICON = {
    iconSize: 3.0,
    minZoom: 0,                 // set to e.g. 8.0 to hide until zoomed in
    iconRotateOffsetDeg: 0,     // adjust if your SVG faces wrong direction
    iconOffsetPx: 12            // perpendicular offset from line at midpoint; sign flips side
  };

  const ICONS = {
    boat: { id: 'boat-icon', url: './icons/boat.svg' },
    smallboat: { id: 'smallboat-icon', url: './icons/smallboat.svg' }
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

    map.addImage(id, img, { pixelRatio });
  }

  function buildBoatRouteFeatures(map, route, routeId) {
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
      properties: { kind: 'boat-line', routeId },
      geometry: { type: 'LineString', coordinates: coords }
    };

    if (!route.showIcon) return [lineFeature];

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
      properties: {
        kind: 'boat-icon',
        routeId,
        angle: angleDeg,
        iconType: route.iconType
      },
      geometry: { type: 'Point', coordinates: [iconLL.lng, iconLL.lat] }
    };

    return [lineFeature, iconFeature];
  }

  window.addEventListener('travelMap:ready', async (e) => {
    const map = e.detail.map;

    // ---- ICON LOADING ----
    await loadSvgAsMapImage(map, ICONS.boat.id, ICONS.boat.url, 2);
    await loadSvgAsMapImage(map, ICONS.smallboat.id, ICONS.smallboat.url, 2);

    // ---- SOURCE ----
    if (!map.getSource('boatRoutes')) {
      map.addSource('boatRoutes', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
    }

    // ---- LAYERS ----
    if (!map.getLayer('boat-route-line')) {
      map.addLayer({
        id: 'boat-route-line',
        type: 'line',
        source: 'boatRoutes',
        filter: ['==', ['get', 'kind'], 'boat-line'],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': LINE.color,
          'line-width': LINE.width,
          'line-opacity': LINE.opacity
        }
      });
    }

    if (!map.getLayer('boat-route-icon')) {
      map.addLayer({
        id: 'boat-route-icon',
        type: 'symbol',
        source: 'boatRoutes',
        filter: ['==', ['get', 'kind'], 'boat-icon'],
        minzoom: BOAT_ICON.minZoom,
        layout: {
          'icon-image': [
            'match',
            ['get', 'iconType'],
            'boat', ICONS.boat.id,
            'smallboat', ICONS.smallboat.id,
            ICONS.boat.id
          ],
          'icon-size': ['get', 'iconSize'],
          'icon-rotation-alignment': 'map',
          'icon-keep-upright': false,
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'icon-rotate': ['+', ['get', 'angle'], BOAT_ICON.iconRotateOffsetDeg]
        }
      });
    }

    // ---- ROUTE DEFINITIONS ----
    // iconType must be: "boat" | "smallboat"
    const routes = [
      // EXAMPLE:
      // {
      //   id: 'example_boat_route',
      //   from: [-82.2479, 9.3406],
      //   to: [-82.3000, 9.2500],
      //   fromRadius: R_PRIMARY,
      //   toRadius: R_PRIMARY,
      //   iconType: 'boat',
      //   showIcon: true,
      //
      //   // Optional overrides:
      //   iconSize: BOAT_ICON.iconSize,
      //   iconOffsetPx: BOAT_ICON.iconOffsetPx
      // }
    ];

    function updateBoatRoutes() {
      const features = [];
      for (const r of routes) {
        const route = {
          ...r,
          iconType: r.iconType || 'boat',
          showIcon: r.showIcon !== false,
          iconSize: typeof r.iconSize === 'number' ? r.iconSize : BOAT_ICON.iconSize,
          iconOffsetPx: typeof r.iconOffsetPx === 'number' ? r.iconOffsetPx : BOAT_ICON.iconOffsetPx
        };

        const built = buildBoatRouteFeatures(map, route, route.id);

        for (const f of built) {
          if (f.properties && f.properties.kind === 'boat-icon') {
            f.properties.iconSize = route.iconSize;
          }
        }

        features.push(...built);
      }

      map.getSource('boatRoutes').setData({
        type: 'FeatureCollection',
        features
      });
    }

    updateBoatRoutes();
    map.once('idle', updateBoatRoutes);
    map.on('move', updateBoatRoutes);
    map.on('zoom', updateBoatRoutes);
    map.on('resize', updateBoatRoutes);
  });
})();
