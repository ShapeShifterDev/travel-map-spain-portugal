// Car routes only.
// - Gently curved routes (screen-space quadratic bezier) that look consistent across zoom
// - Starts/ends at the center edge of the pin circles (trimmed to pin radius)
// - Car icon placed near the midpoint and offset slightly above/below the line
// - Car icon rotated to direction of travel (with optional rotation offset for your SVG)

// Expects:
// - maplibregl loaded
// - map.js dispatches "travelMap:ready" with { map }
// - icons/car.svg exists
// - This file assumes pins are bottom-anchored and pin radii match pins.js styles.
// - You can add as many routes as you want by pushing to `routes` array.

(function () {
  // ---- PIN RADII (must match pins.js CSS) ----
  // Primary pin is 30px diameter => radius 15
  // Secondary pin is 18px diameter => radius 9
  const R_PRIMARY = 15;
  const R_SECONDARY = 9;

  // ---- ROUTE STYLING (adjust these) ----
  const LINE_COLOR = '#2f9e6f';
  const LINE_WIDTH = 3;
  const LINE_OPACITY = 0.85;

  // ---- CURVE SHAPE (adjust these) ----
  // curvatureFactor controls bend relative to on-screen distance between points.
  // minPx / maxPx clamp curvature so it doesn't look too bendy when zoomed out.
  const CURVE = {
    curvatureFactor: 0.18,
    minPx: 18,
    maxPx: 55,
    segments: 90
  };

  // ---- ICON SETTINGS (adjust these) ----
  const CAR_ICON = {
    // icon-size: number. Larger = bigger icon.
    iconSize: 3.5,

    // minzoom: number. Car icon won't show until user zooms in past this.
    minZoom: 8.0,

    // iconRotateOffsetDeg: degrees added to computed direction.
    // Use this to fix SVG orientation (e.g., if SVG points "up" by default). Chose -90, 0, 90, 180 for event orientation changes. 
    iconRotateOffsetDeg: 180,

    // iconOffsetPx: perpendicular offset from the line at midpoint.
    // Positive vs negative flips which side of the line the icon sits on.
    iconOffsetPx: 12
  };

  // ---------- Geometry helpers ----------
  function pinCenterScreenPoint(map, lngLat, radiusPx) {
    // Marker anchor is bottom-center; center of circle is radiusPx above the anchor.
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

    // Move from centers to circle edges along the line direction
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

    // Perpendicular unit vector
    const px = -dy / len;
    const py = dx / len;

    // Control point for quadratic bezier
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

  // Build one route's line + car icon features.
  // If showCarIcon is false, only returns the line feature.
  function buildCarRouteFeatures(map, route, routeId) {
    const [startLL, endLL] = trimToCircleEdges(
      map,
      route.from,
      route.to,
      route.fromRadius,
      route.toRadius
    );

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
      properties: { kind: 'car-line', routeId },
      geometry: { type: 'LineString', coordinates: coords }
    };

    if (!route.showCarIcon) {
      return [lineFeature];
    }

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

    // Perpendicular for offset
    const nx = -dy / len;
    const ny = dx / len;

    const pMid = map.project({ lng: mid[0], lat: mid[1] });
    const pCar = {
      x: pMid.x + nx * route.iconOffsetPx,
      y: pMid.y + ny * route.iconOffsetPx
    };
    const carLL = map.unproject(pCar);

    const carFeature = {
      type: 'Feature',
      properties: {
        kind: 'car-icon',
        routeId,
        angle: angleDeg
      },
      geometry: {
        type: 'Point',
        coordinates: [carLL.lng, carLL.lat]
      }
    };

    return [lineFeature, carFeature];
  }

  window.addEventListener('travelMap:ready', async (e) => {
    const map = e.detail.map;

    // ---- ICON LOADING ----
    // Ensure your file exists at: ./icons/car.svg
    await loadSvgAsMapImage(map, 'car-icon', './icons/car.svg', 2);

    // ---- SOURCE ----
    if (!map.getSource('carRoutes')) {
      map.addSource('carRoutes', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
    }

    // ---- LAYERS ----
    // Car route line layer
    if (!map.getLayer('car-route-line')) {
      map.addLayer({
        id: 'car-route-line',
        type: 'line',
        source: 'carRoutes',
        filter: ['==', ['get', 'kind'], 'car-line'],
        layout: {
          'line-join': 'round',
          'line-cap': 'round'
        },
        paint: {
          'line-color': LINE_COLOR,
          'line-width': LINE_WIDTH,
          'line-opacity': LINE_OPACITY
        }
      });
    }

    // Car icon layer
    if (!map.getLayer('car-route-icon')) {
      map.addLayer({
        id: 'car-route-icon',
        type: 'symbol',
        source: 'carRoutes',
        filter: ['==', ['get', 'kind'], 'car-icon'],
        minzoom: CAR_ICON.minZoom,
        layout: {
          'icon-image': 'car-icon',
          'icon-size': CAR_ICON.iconSize,
          'icon-rotation-alignment': 'map',
          'icon-keep-upright': false,
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          // Rotation = direction angle + offset (adjust offset if your SVG faces wrong way)
          'icon-rotate': ['+', ['get', 'angle'], CAR_ICON.iconRotateOffsetDeg]
        }
      });
    }

    // ---- ROUTE DEFINITIONS ----
    // Define named coordinate constants here to keep things readable.
    // Format: [longitude, latitude]
    // const cityA = [-90.7346, 14.5586];
    // const cityB = [-91.1580, 14.7409];
    // \/ ADD THESE HERE \/ 


    
    // Add routes by pushing objects into this array.
    // Required fields:
    // - id: unique string
    // - from: [lng, lat]
    // - to: [lng, lat]
    // - fromRadius / toRadius: use R_PRIMARY or R_SECONDARY based on pin size
    // Optional fields:
    // - showCarIcon: true/false (default true)
    // - iconOffsetPx: number (perpendicular offset; positive/negative flips side)
    
    const routes = [

      {
         id: 'port_to_sant',
         from: [-8.6291, 41.1579],
         to: [-8.5448, 42.8782],
         fromRadius: R_PRIMARY,
         toRadius: R_PRIMARY,
      },

      {
         id: 'sant_to_ov',
         from: [-8.5448, 42.8782],
         to: [-5.8494, 43.3619],
         fromRadius: R_PRIMARY,
         toRadius: R_PRIMARY,
      },

      {
         id: 'ov_to_bilb',
         from: [-5.8494, 43.3619],
         to: [-2.9349, 43.2630],
         fromRadius: R_PRIMARY,
         toRadius: R_PRIMARY,
      }
      
      // EXAMPLE: primary -> primary (shows car icon)
      // {
      //   id: 'antigua_to_panajachel',
      //   from: [-90.7346, 14.5586],
      //   to: [-91.1580, 14.7409],
      //   fromRadius: R_PRIMARY,
      //   toRadius: R_PRIMARY,
      //   showCarIcon: true,
      //   iconOffsetPx: CAR_ICON.iconOffsetPx
      // },

      // EXAMPLE: primary -> secondary (still shows car icon)
      // {
      //   id: 'panajachel_to_nahuizalco',
      //   from: [-91.1580, 14.7409],
      //   to: [-89.7360, 13.7770],
      //   fromRadius: R_PRIMARY,
      //   toRadius: R_SECONDARY,
      //   showCarIcon: true,
      //   iconOffsetPx: CAR_ICON.iconOffsetPx
      // },

      // EXAMPLE: route with NO car icon (line only)
      // {
      //   id: 'nahuizalco_to_juayua_no_car',
      //   from: [-89.7360, 13.7770],
      //   to: [-89.7450, 13.8410],
      //   fromRadius: R_SECONDARY,
      //   toRadius: R_PRIMARY,
      //   showCarIcon: false
      // }
    ];

    function updateCarRoutes() {
      const features = [];
      for (const r of routes) {
        const route = {
          ...r,
          showCarIcon: r.showCarIcon !== false,
          iconOffsetPx: typeof r.iconOffsetPx === 'number' ? r.iconOffsetPx : CAR_ICON.iconOffsetPx
        };

        features.push(...buildCarRouteFeatures(map, route, route.id));
      }

      map.getSource('carRoutes').setData({
        type: 'FeatureCollection',
        features
      });
    }

    updateCarRoutes();
    map.once('idle', updateCarRoutes);
    map.on('move', updateCarRoutes);
    map.on('zoom', updateCarRoutes);
    map.on('resize', updateCarRoutes);
  });
})();
