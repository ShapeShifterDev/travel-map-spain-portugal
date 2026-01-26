// Base map bootstrap only. Exposes the MapLibre map instance via a window event: "travelMap:ready"

(function () {
  function createMap() {
    if (!document.getElementById('map')) {
      console.error('Map container #map not found. Add <div id="map"></div> to your page.');
      return;
    }

    const map = new maplibregl.Map({
      container: 'map',

      // ---- MAP STYLE ----
      // This should remain a MapLibre-compatible style URL
      style: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',

      // ---- INITIAL VIEW ----
      // center format: [longitude, latitude]
      center: [-4.0, 40.0],

      // zoom: number (decimals allowed). 2 = World view. 5 = Regional view. 10 = City view
      zoom: 5.5
    });

    // Standard map UI controls
    map.addControl(new maplibregl.NavigationControl(), 'top-right');

    map.on('load', async () => {

    // ---- OPTIONAL COUNTRY HIGHLIGHT OVERLAY ----
    // Drop a file named "custom.geo.json" next to map.js to enable.
    // Remove the file if no country highlighting is desired.

    const GEOJSON_URL = './custom.geo.json';

    try {
      const res = await fetch(GEOJSON_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error(`GeoJSON HTTP ${res.status}`);

      const geojson = await res.json();

      map.addSource('tripCountries', {
        type: 'geojson',
        data: geojson
      });

      // Soft fill only (no borders)
      map.addLayer({
        id: 'tripCountries-fill',
        type: 'fill',
        source: 'tripCountries',
        paint: {
          'fill-color': 'rgba(255, 232, 163, 1)',
          'fill-opacity': 0.25
        }
      });

    } catch (err) {
      // Silent failure is intentional: map still works without the file
      console.info('No custom.geo.json loaded (this is OK):', err.message);
    }

    // Notify other modules that the map is ready
    window.dispatchEvent(
      new CustomEvent('travelMap:ready', { detail: { map } })
    );
  });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createMap);
  } else {
    createMap();
  }
})();
