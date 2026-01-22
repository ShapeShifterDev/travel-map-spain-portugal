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
      center: [40.3736, 4.2097],

      // zoom: number (decimals allowed). 2 = World view. 5 = Regional view. 10 = City view
      zoom: 5
    });

    // Standard map UI controls
    map.addControl(new maplibregl.NavigationControl(), 'top-right');

    map.on('load', () => {
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
