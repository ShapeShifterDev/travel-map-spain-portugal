// Plane routes only.
// Similar structure to carroutes.js / busroutes.js, with these differences:
// - Flight line is dashed
// - Curve is slightly gentler than car/bus
// - Each route can choose an icon: plane.svg, smallplane.svg, reallysmallplane.svg
// - Same icon adjustment settings apply to all plane icon types
// Expects:
// - maplibregl loaded
// - map.js dispatches "travelMap:ready" with { map }
// - icons/plane.svg, icons/smallplane.svg, icons/reallysmallplane.svg exist (or only the ones you use)
// Notes:
// - This file assumes pins are bottom-anchored and pin radii match pins.js styles.
// - Add routes by pushing to `routes` array.

(function () {
  // ---- PIN RADII (must match pins.js CSS) ----
  const R_PRIMARY = 15;    // 30px / 2
  const R_SECONDARY = 9;   // 18px / 2

  // ---- LINE STYLE (adjust these) ----
  const LINE = {
    color: '#2f9e6f',
    width: 2.5,
    opacity: 0.75,
    // Dash pattern: [dashLength, gapLength]
    dasharray: [2, 2]
  };

  // ---- CURVE SHAPE (slightly gentler than car/bus) ----
  // Make curveFactor lower than car/bus; clamp to avoid over-bending when zoomed out.
  const CURVE = {
    curvatureFactor: 0.14,
    minPx: 14,
    maxPx: 45,
    segments: 90
  };

  // ---- ICON SETTINGS (applies to ALL plane types) ----
  const PLANE_ICON = {
    // Default icon size for plane markers.
    // You can override per-route by setting route.iconSize.
    iconSize: 2.2,

    // If you want icons to appear only when zoomed in:
    minZoom: 0, // set to e.g. 8.0 to hide until zoomed in

    // Add degrees to computed direction to fix SVG orientation.
    // Example: 180 flips direction.
    iconRotateOffsetDeg: 0,

    // Offset icon perpendicular to the line at midpoint.
    // Positive vs negative flips which side of the line the icon sits on.
    iconOffsetPx: -14
  };

  // Map a route "iconType" to an image id + svg file
  const ICONS = {
    plane: { id: 'plane-icon', url: './icons/plane.svg' },
    smallplane: { id: 'smallplane-icon', url: './icons/smallplane.svg' },
    reallysmallplane: { id: 'reallysmallplane-icon', url: './icons/reallysmallplane.svg' }
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

  function buildPlaneRouteFeatures(map, route, routeId) {
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
      properties: { kind: 'plane-line', routeId },
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

    // Perpendicular for offset
    const nx = -dy / len;
    const ny = dx / len;

    const pMid = map.project({ lng: mid[0], lat: mid[1] });
    const pIcon = {
      x: pMid.x + nx * route.iconOffsetPx,
      y: pMid.y + ny * route.iconOffsetPx
    };
    const iconLL = map.unproject(pIcon);

    const iconFeature = {
      type: 'Feature',
      properties: {
        kind: 'plane-icon',
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
    // Load ALL plane icon types up-front. If you prefer, you can remove unused types.
    await loadSvgAsMapImage(map, ICONS.plane.id, ICONS.plane.url, 2);
    await loadSvgAsMapImage(map, ICONS.smallplane.id, ICONS.smallplane.url, 2);
    await loadSvgAsMapImage(map, ICONS.reallysmallplane.id, ICONS.reallysmallplane.url, 2);

    // ---- SOURCE ----
    if (!map.getSource('planeRoutes')) {
      map.addSource('planeRoutes', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
    }

    // ---- LAYERS ----
    // Dashed flight line layer
    if (!map.getLayer('plane-route-line')) {
      map.addLayer({
        id: 'plane-route-line',
        type: 'line',
        source: 'planeRoutes',
        filter: ['==', ['get', 'kind'], 'plane-line'],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': LINE.color,
          'line-width': LINE.width,
          'line-opacity': LINE.opacity,
          'line-dasharray': LINE.dasharray
        }
      });
    }

    // Plane icon layer (supports multiple icon types via a match expression)
    if (!map.getLayer('plane-route-icon')) {
      map.addLayer({
        id: 'plane-route-icon',
        type: 'symbol',
        source: 'planeRoutes',
        filter: ['==', ['get', 'kind'], 'plane-icon'],
        minzoom: PLANE_ICON.minZoom,
        layout: {
          // Choose which icon to render based on feature.properties.iconType
          'icon-image': [
            'match',
            ['get', 'iconType'],
            'plane', ICONS.plane.id,
            'smallplane', ICONS.smallplane.id,
            'reallysmallplane', ICONS.reallysmallplane.id,
            ICONS.plane.id
          ],
          'icon-size': ['get', 'iconSize'],
          'icon-rotation-alignment': 'map',
          'icon-keep-upright': false,
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'icon-rotate': ['+', ['get', 'angle'], PLANE_ICON.iconRotateOffsetDeg]
        }
      });
    }

    // ---- ROUTE DEFINITIONS ----
    // Add plane routes by pushing objects into this array.
    // Format for points: [longitude, latitude]
    // iconType must be one of: "plane" | "smallplane" | "reallysmallplane"
    const routes = [
      // EXAMPLE:
      // {
      //   id: 'example_flight',
      //   from: [-89.2182, 13.6929],     // San Salvador
      //   to: [-79.3835, 9.0714],        // PTY
      //   fromRadius: R_PRIMARY,
      //   toRadius: R_SECONDARY,
      //   iconType: 'plane',             // choose icon
      //   showIcon: true,                // set false for line only
      //
      //   // Optional per-route overrides:
      //   iconSize: PLANE_ICON.iconSize,
      //   iconOffsetPx: PLANE_ICON.iconOffsetPx
      // }

      {
         id: 'sev_to_lisb',
         from: [-5.9845, 37.3891],  
         to: [-9.1393, 38.7223],        
         fromRadius: R_PRIMARY,
         toRadius: R_PRIMARY,
         iconType: 'plane',             // choose icon
         showIcon: true,                // set false for line only
      },

      {
         id: 'san_to_barc',
         from: [-1.9812, 43.3183],  
         to: [2.1686, 41.3874],        
         fromRadius: R_PRIMARY,
         toRadius: R_PRIMARY,
         iconType: 'plane',             // choose icon
         showIcon: true,                // set false for line only
      }
    ];

    function updatePlaneRoutes() {
      const features = [];
      for (const r of routes) {
        const route = {
          ...r,
          iconType: r.iconType || 'plane',
          showIcon: r.showIcon !== false,
          iconSize: typeof r.iconSize === 'number' ? r.iconSize : PLANE_ICON.iconSize,
          iconOffsetPx: typeof r.iconOffsetPx === 'number' ? r.iconOffsetPx : PLANE_ICON.iconOffsetPx
        };

        const built = buildPlaneRouteFeatures(map, route, route.id);

        // Inject iconSize into the icon feature so the layer can read it via ['get','iconSize']
        for (const f of built) {
          if (f.properties && f.properties.kind === 'plane-icon') {
            f.properties.iconSize = route.iconSize;
          }
        }

        features.push(...built);
      }

      map.getSource('planeRoutes').setData({
        type: 'FeatureCollection',
        features
      });
    }

    updatePlaneRoutes();
    map.once('idle', updatePlaneRoutes);
    map.on('move', updatePlaneRoutes);
    map.on('zoom', updatePlaneRoutes);
    map.on('resize', updatePlaneRoutes);
  });
})();
