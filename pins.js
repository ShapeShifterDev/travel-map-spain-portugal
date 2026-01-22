// Responsible ONLY for city pins and their styling.
// - Creates circular pins that can be "primary" (shows nights number) or "secondary" (small, no number)
// - Optional label under the pin (e.g., Start / End)
// - Hover tooltip shows city name and (if primary) "X Nights"
// Expects: maplibregl loaded, and map.js dispatches "travelMap:ready"

(function () {
  function ensurePinStyles() {
    if (document.getElementById('pin-styles')) return;

    const style = document.createElement('style');
    style.id = 'pin-styles';
    style.textContent = `
      .pin-wrap{
        position: relative;
        width: 0;
        height: 0;
      }

      .pin{
        position: absolute;
        left: 0;
        bottom: 0;
        transform: translateX(-50%);

        width: 30px;
        height: 30px;
        border-radius: 999px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: 700;
        font-size: 14px;
        user-select: none;
        cursor: pointer;

        background-color: rgba(159, 216, 181, 0.55);
        color: #1f4d3a;

        border: 2px solid rgba(255, 255, 255, 0.95);
        box-shadow: 0 2px 6px rgba(0,0,0,0.18);
      }

      /* Secondary stop: smaller pin, no nights number shown inside */
      .pin.small{
        width: 18px;
        height: 18px;
        font-size: 12px;
        font-weight: 700;
      }

      /* Optional styling example: highlight a "start" pin border */
      .pin.start{
        border-color: #2f9e6f;
      }

      /* Optional label under the pin (e.g., Start / End) */
      .pin-label{
        position: absolute;
        left: 0;
        bottom: -26px;
        transform: translateX(-50%);
        font-size: 12px;
        font-weight: 700;
        color: #1f4d3a;
        background: rgba(255,255,255,0.85);
        padding: 2px 6px;
        border-radius: 999px;
        line-height: 1;
        white-space: nowrap;
        box-shadow: 0 1px 4px rgba(0,0,0,0.12);
        pointer-events: none;
      }
    `;
    document.head.appendChild(style);
  }

  function addCityPin(map, { lng, lat, city, nights, small = false, label, start = false }) {
    const wrap = document.createElement('div');
    wrap.className = 'pin-wrap';

    const el = document.createElement('div');
    el.className = small ? 'pin small' : 'pin';
    if (start) el.classList.add('start');

    // Pin face: primary pins show nights number, secondary pins are blank
    if (!small && typeof nights === 'number') {
      el.textContent = String(nights);
    } else {
      el.textContent = '';
    }

    wrap.appendChild(el);

    // Optional label under pin (does not affect positioning)
    if (typeof label === 'string' && label.trim()) {
      const lab = document.createElement('div');
      lab.className = 'pin-label';
      lab.textContent = label.trim();
      wrap.appendChild(lab);
    }

    // Tooltip content
    let tooltipHtml = `<div style="font-weight:700;">${city}</div>`;
    if (!small && typeof nights === 'number') {
      tooltipHtml += `<div style="font-size:12px;">${nights} Night${nights === 1 ? '' : 's'}</div>`;
    }

    const popup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 16
    }).setHTML(tooltipHtml);

    new maplibregl.Marker({ element: wrap, anchor: 'bottom' })
      .setLngLat([lng, lat])
      .addTo(map);

    el.addEventListener('mouseenter', () => popup.setLngLat([lng, lat]).addTo(map));
    el.addEventListener('mouseleave', () => popup.remove());
  }

  window.addEventListener('travelMap:ready', (e) => {
    const map = e.detail.map;

    ensurePinStyles();

    // Add pins by calling addCityPin(map, {...}) below.

    //Format: addCityPin(map, options)
    // options:
    // lng, lat: number (longitude, latitude)
    // city: string (tooltip title)
    // nights: number (PRIMARY pins only; displayed inside pin and in tooltip)
    // small: boolean (SECONDARY pins; smaller, no nights text inside)
    // label: string (optional label shown under pin; e.g., "Start", "End")
    // start: boolean (optional; applies .pin.start styling)

    addCityPin(map, {
       lng: 2.1686,
       lat: 41.3874,
       city: 'Barcelona',
       nights: 5,
       label: 'Start / End'
    });

    // ---- EXAMPLES ----

    // Example PRIMARY pin (shows nights number inside the circle)
    // addCityPin(map, {
    //   lng: -90.7346,
    //   lat: 14.5586,
    //   city: 'Antigua Guatemala',
    //   nights: 2
    // });

    // Example SECONDARY pin (smaller, no number inside)
    // addCityPin(map, {
    //   lng: -90.5069,
    //   lat: 14.6349,
    //   city: 'Guatemala City',
    //   small: true
    // });

    // Example START label under a secondary pin (and optional border highlight)
    // addCityPin(map, {
    //   lng: -90.5069,
    //   lat: 14.6349,
    //   city: 'Guatemala City',
    //   small: true,
    //   start: true,
    //   label: 'Start'
    // });

    // Example END label under a primary pin
    // addCityPin(map, {
    //   lng: -79.5199,
    //   lat: 8.9824,
    //   city: 'Panama City',
    //   nights: 3,
    //   label: 'End'
    // });
    
  });

  // If you want to reuse addCityPin from other files later, you can expose it:
  // window.addCityPin = addCityPin;
})();
