// Initialize Lucide icons
lucide.createIcons();

// Helper to copy to clipboard in both secure and local file:// contexts
function copyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).catch(err => {
            console.error("Clipboard error:", err);
        });
    } else {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";
        textArea.style.left = "-999999px";
        textArea.style.top = "-999999px";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
            document.execCommand('copy');
        } catch (err) {
            console.error("Clipboard fallback error:", err);
        }
        textArea.remove();
    }
}

// Image files
const mapImages = {
    blank: 'mapping/snow_blank.png',
    postals: 'mapping/snow_postals.png'
};

// Native zoom level where 1 map pixel = 1 image pixel
const nativeZoom = 2;
// Max zoom level allowed (higher means further zoomed in)
const maxZoomAllowed = 5;

// Create map with zoom constraints set from the start
const map = L.map('map', {
    crs: L.CRS.Simple,
    zoomControl: false,
    maxZoom: maxZoomAllowed
});

let blankOverlay = null;
let postalsOverlay = null;

// Load image to get dimensions
const img = new Image();
img.onload = function () {

    const w = this.width;
    const h = this.height;

    // Calculate bounds based on image size
    const southWest = map.unproject([0, h], nativeZoom);
    const northEast = map.unproject([w, 0], nativeZoom);
    const bounds = new L.LatLngBounds(southWest, northEast);

    // Initial image selection
    const postalToggle = document.getElementById('postal-toggle');
    const savedToggleState = localStorage.getItem('postal-toggle-enabled');

    if (savedToggleState !== null) {
        postalToggle.checked = savedToggleState === 'true';
    } else {
        postalToggle.checked = true; // Default to enabled
    }

    // Add image overlays
    blankOverlay = L.imageOverlay(mapImages.blank, bounds).addTo(map);
    postalsOverlay = L.imageOverlay(mapImages.postals, bounds).addTo(map);

    function updateOverlayVisibility() {
        if (postalToggle.checked) {
            postalsOverlay.setOpacity(1);
            blankOverlay.setOpacity(0);
        } else {
            postalsOverlay.setOpacity(0);
            blankOverlay.setOpacity(1);
        }
    }

    updateOverlayVisibility();

    // Handle toggle change
    postalToggle.addEventListener('change', (e) => {
        const isEnabled = e.target.checked;
        localStorage.setItem('postal-toggle-enabled', isEnabled);
        updateOverlayVisibility();
    });

    // Update minimum zoom to prevent zooming out further than the image
    function updateMinZoom() {
        const minZ = map.getBoundsZoom(bounds, false);
        map.setMinZoom(minZ);
    }
    updateMinZoom();
    map.on('resize', updateMinZoom);

    // Restrict map movement
    map.setMaxBounds(bounds);

    // Fit map to image, respecting zoom constraints
    map.fitBounds(bounds, { maxZoom: maxZoomAllowed });

    // Add zoom controls (top right)
    L.control.zoom({
        position: 'topright'
    }).addTo(map);

    // Handle right-click
    map.on('contextmenu', (e) => {

        // Prevent browser menu
        if (e.originalEvent) {
            e.originalEvent.preventDefault();
        }

        // Convert click to pixel coordinates
        const pixelPoint = map.project(e.latlng, nativeZoom);
        const x = pixelPoint.x.toFixed(2);
        const y = pixelPoint.y.toFixed(2);

        const textToCopy = `x: ${x}, y: ${y}`;

        // Copy coordinates
        copyToClipboard(textToCopy);

        // Add temporary red dot
        const dot = L.circleMarker(e.latlng, {
            radius: 5,
            color: 'red',
            fillColor: 'red',
            fillOpacity: 1,
            weight: 0,
            interactive: false
        }).addTo(map);

        // Remove dot after 1 second
        setTimeout(() => {
            map.removeLayer(dot);
        }, 1000);
    });

    // Handle middle-click measurement
    let isMeasuring = false;
    let measurePoints = [];
    let measureLine = null;

    // Prevent default browser autoscroll behavior on middle click
    map.getContainer().addEventListener('mousedown', (e) => {
        if (e.button === 1) { // Middle click
            e.preventDefault();
            map.dragging.disable();

            isMeasuring = true;
            measurePoints = [map.mouseEventToLatLng(e)];

            if (measureLine) {
                map.removeLayer(measureLine);
            }

            measureLine = L.polyline(measurePoints, {
                color: 'blue',
                weight: 3,
                interactive: false
            }).addTo(map);
        }
    });

    map.getContainer().addEventListener('mousemove', (e) => {
        if (isMeasuring && measureLine) {
            measurePoints.push(map.mouseEventToLatLng(e));
            measureLine.setLatLngs(measurePoints);
        }
    });

    window.addEventListener('mouseup', (e) => {
        if (e.button === 1 && isMeasuring) {
            isMeasuring = false;
            map.dragging.enable();

            if (measurePoints.length > 0 && measureLine) {
                let totalDistance = 0;

                for (let i = 1; i < measurePoints.length; i++) {
                    const p1 = map.project(measurePoints[i - 1], nativeZoom);
                    const p2 = map.project(measurePoints[i], nativeZoom);

                    const dx = p2.x - p1.x;
                    const dy = p2.y - p1.y;
                    totalDistance += Math.sqrt(dx * dx + dy * dy);
                }

                const distanceStr = totalDistance.toFixed(2);

                copyToClipboard(distanceStr);

                map.removeLayer(measureLine);
                measureLine = null;
                measurePoints = [];
            }
        }
    });
};

// Start loading image
img.src = mapImages.postals; // Use one of the images to get dimensions

// --- Dropdown Functionality ---
document.querySelectorAll('.dropdown-header').forEach(header => {
    header.addEventListener('click', () => {
        const dropdown = header.parentElement;
        dropdown.classList.toggle('open');
    });
});

// --- PRC API Location Feature ---

const apiKeyInput = document.getElementById('api-key');
const playerNameInput = document.getElementById('player-name');
const getLocationBtn = document.getElementById('get-location-btn');
const addressOutput = document.getElementById('address-output');
const coordsOutput = document.getElementById('coords-output');

// Load saved API key
const savedApiKey = localStorage.getItem('prc-api-key');
if (savedApiKey) {
    apiKeyInput.value = savedApiKey;
}

let activeMarker = null;
let markerTimeout = null;

getLocationBtn.addEventListener('click', async () => {
    const apiKey = apiKeyInput.value.trim();
    const playerName = playerNameInput.value.trim();

    if (!apiKey) {
        showError("Please enter an API Key");
        return;
    }
    if (!playerName) {
        showError("Please enter a Player Name");
        return;
    }

    // Save API key for convenience
    localStorage.setItem('prc-api-key', apiKey);

    setLoading(true);

    try {
        const response = await fetch(`https://api.policeroleplay.community/v2/server?Players=true`, {
            headers: {
                'server-key': apiKey
            }
        });

        if (!response.ok) {
            if (response.status === 403) throw new Error("Invalid API Key or Unauthorized");
            if (response.status === 429) throw new Error("Rate limited. Please wait.");
            throw new Error(`API Error: ${response.status}`);
        }

        const data = await response.json();
        const player = data.Players?.find(p =>
            p.Player.split(':')[0].toLowerCase() === playerName.toLowerCase()
        );

        if (!player) {
            throw new Error("Player not found in server");
        }

        const loc = player.Location;
        if (!loc) {
            throw new Error("Player location data unavailable");
        }

        // Update output boxes
        addressOutput.textContent = `${loc.BuildingNumber} ${loc.StreetName}, Postal ${loc.PostalCode}`;
        coordsOutput.textContent = `X: ${loc.LocationX.toFixed(2)}, Z: ${loc.LocationZ.toFixed(2)}`;

        // Convert coordinates to Leaflet LatLng
        // The API gives X and Z (representing Y in 2D image)
        const latlng = map.unproject([loc.LocationX, loc.LocationZ], nativeZoom);

        // Remove previous marker if exists
        if (activeMarker) {
            map.removeLayer(activeMarker);
        }
        if (markerTimeout) {
            clearTimeout(markerTimeout);
        }

        // Add green dot marker
        activeMarker = L.circleMarker(latlng, {
            radius: 5,
            color: '#22c55e', // green-500
            fillColor: '#22c55e',
            fillOpacity: 1,
            weight: 0,
            interactive: false
        }).addTo(map);

        // Remove marker after 5 seconds
        markerTimeout = setTimeout(() => {
            if (activeMarker) {
                map.removeLayer(activeMarker);
                activeMarker = null;
            }
            markerTimeout = null;
        }, 5000);

    } catch (err) {
        showError(err.message);
    } finally {
        setLoading(false);
    }
});

function setLoading(isLoading) {
    getLocationBtn.disabled = isLoading;
    if (isLoading) {
        getLocationBtn.classList.add('loading');
        getLocationBtn.innerHTML = '<i data-lucide="loader-2" class="animate-spin"></i> Loading...';
    } else {
        getLocationBtn.classList.remove('loading');
        getLocationBtn.innerHTML = '<i data-lucide="map-pin"></i> Get Location';
    }
    lucide.createIcons();
}

function showError(message) {
    getLocationBtn.classList.add('error');
    alert(message);
    setTimeout(() => {
        getLocationBtn.classList.remove('error');
    }, 2000);
}
