// Bus routes only.
// Identical behavior to carroutes.js, except it uses ./icons/bus.svg for the icon.
// Keeps bus routes in a separate file for modular trip setups.
// Expects:
// - maplibregl loaded
// - map.js dispatches "travelMap:ready" with { map }
// - icons/bus.svg exists

(function () {
  // ---- PIN RADII (must match pins.js CSS) ----
  const R_PRIMARY = 15;    // 30px / 2
  const R_SECONDARY = 9;   // 18px / 2

  // ---- ROUTE STYLING (adjust these) ----
  const LINE_COLOR = '#2f9e6f';
  const LINE_WIDTH = 3;
  const LINE_OPACITY = 0.85;

  // ---- CURVE SHAPE (adjust these) ----
  const CURVE = {
    curvatureFactor: 0.18,
    minPx: 18,
    maxPx: 55,
    segments: 90
  };

  // ---- ICON SETTINGS (adjust these) ----
  const BUS_ICON = {
    iconSize: 3.5,
    minZoom: 8.0,
    iconRotateOffsetDeg: 180, // adjust if bus.svg faces wrong way
    iconOffsetPx: 12          // positive/negative flips which side of the line the icon sits on
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

  function buildBusRouteFeatures(map, route, routeId) {
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
      properties: { kind: 'bus-line', routeId },
      geometry: { type: 'LineString', coordinates: coords }
    };

    if (!route.showBusIcon) return [lineFeature];

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
    const pBus = { x: pMid.x + nx * route.iconOffsetPx, y: pMid.y + ny * route.iconOffsetPx };
    const busLL = map.unproject(pBus);

    const busFeature = {
      type: 'Feature',
      properties: { kind: 'bus-icon', routeId, angle: angleDeg },
      geometry: { type: 'Point', coordinates: [busLL.lng, busLL.lat] }
    };

    return [lineFeature, busFeature];
  }

  window.addEventListener('travelMap:ready', async (e) => {
    const map = e.detail.map;

    // ---- ICON LOADING ----
    // Ensure your file exists at: ./icons/bus.svg
    await loadSvgAsMapImage(map, 'bus-icon', './icons/bus.svg', 2);

    // ---- SOURCE ----
    if (!map.getSource('busRoutes')) {
      map.addSource('busRoutes', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
    }

    // ---- LAYERS ----
    if (!map.getLayer('bus-route-line')) {
      map.addLayer({
        id: 'bus-route-line',
        type: 'line',
        source: 'busRoutes',
        filter: ['==', ['get', 'kind'], 'bus-line'],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': LINE_COLOR,
          'line-width': LINE_WIDTH,
          'line-opacity': LINE_OPACITY
        }
      });
    }

    if (!map.getLayer('bus-route-icon')) {
      map.addLayer({
        id: 'bus-route-icon',
        type: 'symbol',
        source: 'busRoutes',
        filter: ['==', ['get', 'kind'], 'bus-icon'],
        minzoom: BUS_ICON.minZoom,
        layout: {
          'icon-image': 'bus-icon',
          'icon-size': BUS_ICON.iconSize,
          'icon-rotation-alignment': 'map',
          'icon-keep-upright': false,
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'icon-rotate': ['+', ['get', 'angle'], BUS_ICON.iconRotateOffsetDeg]
        }
      });
    }

    // ---- ROUTE DEFINITIONS ----
    // Add bus routes by pushing objects into this array.
    // Format for points: [longitude, latitude]
    const routes = [
      // EXAMPLE (line + icon):
      // {
      //   id: 'example_bus_route',
      //   from: [-90.7346, 14.5586],
      //   to: [-91.1580, 14.7409],
      //   fromRadius: R_PRIMARY,
      //   toRadius: R_PRIMARY,
      //   showBusIcon: true,
      //   iconOffsetPx: BUS_ICON.iconOffsetPx
      // },

      // EXAMPLE (line only, no icon):
      // {
      //   id: 'example_bus_route_no_icon',
      //   from: [-89.7360, 13.7770],
      //   to: [-89.7450, 13.8410],
      //   fromRadius: R_SECONDARY,
      //   toRadius: R_PRIMARY,
      //   showBusIcon: false
      // }
    ];

    function updateBusRoutes() {
      const features = [];
      for (const r of routes) {
        const route = {
          ...r,
          showBusIcon: r.showBusIcon !== false,
          iconOffsetPx: typeof r.iconOffsetPx === 'number' ? r.iconOffsetPx : BUS_ICON.iconOffsetPx
        };
        features.push(...buildBusRouteFeatures(map, route, route.id));
      }

      map.getSource('busRoutes').setData({
        type: 'FeatureCollection',
        features
      });
    }

    updateBusRoutes();
    map.once('idle', updateBusRoutes);
    map.on('move', updateBusRoutes);
    map.on('zoom', updateBusRoutes);
    map.on('resize', updateBusRoutes);
  });
})();
