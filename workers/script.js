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

// --- Routing & Autocomplete Logic ---

let mapData = { nodes: [], edges: [], adjacencyList: {} };
let startNode = null;
let destinationNode = null;
let routeLayers = [];

// Fetch map data
async function loadMapData() {
    try {
        const response = await fetch('mapping/mapping.json');
        mapData = await response.json();

        // Build adjacency list for Dijkstra optimization
        mapData.adjacencyList = {};
        mapData.nodes.forEach(node => {
            mapData.adjacencyList[node.id] = [];
        });
        mapData.edges.forEach(edge => {
            mapData.adjacencyList[edge.from].push({ to: edge.to, edge });
            mapData.adjacencyList[edge.to].push({ to: edge.from, edge });
        });
    } catch (err) {
        console.error("Failed to load map data:", err);
    }
}
loadMapData();

function setupAutocomplete(inputId, listId) {
    const input = document.getElementById(inputId);
    const list = document.getElementById(listId);

    const updateList = () => {
        const query = input.value.toLowerCase().trim();
        list.innerHTML = '';

        // Clear selection if input changes
        if (inputId === 'starting-input' && startNode && input.value !== startNode.label) {
            startNode = null;
        }
        if (inputId === 'destination-input' && destinationNode && input.value !== destinationNode.label) {
            destinationNode = null;
        }

        if (!query) {
            list.style.display = 'none';
            return;
        }

        const matches = mapData.nodes.filter(node =>
            node.label.toLowerCase().includes(query) ||
            (node.address && node.address.toLowerCase().includes(query))
        ).slice(0, 5);

        if (matches.length > 0) {
            matches.forEach(node => {
                const item = document.createElement('div');
                item.className = 'autocomplete-item';

                let html = `<span class="item-label">${node.label}</span>`;
                if (node.address) {
                    html += `<span class="item-address">${node.address}</span>`;
                }

                item.innerHTML = html;
                item.addEventListener('click', () => {
                    input.value = node.label;
                    list.style.display = 'none';
                    if (inputId === 'starting-input') startNode = node;
                    if (inputId === 'destination-input') destinationNode = node;
                    if (inputId === 'search-bar') {
                        const latlng = map.unproject([node.x, node.y], nativeZoom);
                        map.flyTo(latlng, maxZoomAllowed);
                    }
                });
                list.appendChild(item);
            });
            list.style.display = 'block';
        } else {
            list.style.display = 'none';
        }
    };

    input.addEventListener('input', updateList);
    input.addEventListener('focus', updateList);

    // Close list when clicking outside
    document.addEventListener('click', (e) => {
        if (!input.contains(e.target) && !list.contains(e.target)) {
            list.style.display = 'none';
        }
    });
}

setupAutocomplete('search-bar', 'search-autocomplete');
setupAutocomplete('starting-input', 'starting-autocomplete');
setupAutocomplete('destination-input', 'destination-autocomplete');

// Dijkstra's Algorithm
function findFastestRoute(startId, endId) {
    const nodes = mapData.nodes;
    const adjacencyList = mapData.adjacencyList;

    const distances = {};
    const prev = {};
    const pq = new Set();

    nodes.forEach(node => {
        distances[node.id] = Infinity;
        prev[node.id] = null;
        pq.add(node.id);
    });

    distances[startId] = 0;

    while (pq.size > 0) {
        let u = null;
        pq.forEach(nodeId => {
            if (u === null || distances[nodeId] < distances[u]) {
                u = nodeId;
            }
        });

        if (u === endId || distances[u] === Infinity) break;

        pq.delete(u);

        const neighbors = adjacencyList[u] || [];
        neighbors.forEach(({ to: v, edge }) => {
            if (!pq.has(v)) return;

            // Weight = distance / speed (time)
            const weight = edge.distance / (edge.speed || 40);
            const alt = distances[u] + weight;

            if (alt < distances[v]) {
                distances[v] = alt;
                prev[v] = { nodeId: u, edge };
            }
        });
    }

    const path = [];
    let curr = endId;
    while (prev[curr]) {
        path.unshift({
            from: prev[curr].nodeId,
            to: curr,
            edge: prev[curr].edge
        });
        curr = prev[curr].nodeId;
    }

    return path.length > 0 || startId === endId ? path : null;
}

function generateDirections(path) {
    if (!path || path.length === 0) return ["You have arrived at your destination."];

    const directions = [];
    let currentRoad = null;

    path.forEach((step, index) => {
        const toNode = mapData.nodes.find(n => n.id === step.to);
        const roadName = toNode.label.includes('&') ? toNode.label.split('&')[0].trim() : toNode.label;

        if (index === 0) {
            directions.push(`Head towards ${toNode.label}`);
            currentRoad = roadName;
        } else if (roadName !== currentRoad) {
            directions.push(`Turn onto ${toNode.label}`);
            currentRoad = roadName;
        } else if (index === path.length - 1) {
            directions.push(`Arrive at ${toNode.label}`);
        }
    });

    return directions;
}

document.getElementById('go-btn').addEventListener('click', () => {
    if (!startNode || !destinationNode) {
        alert("Please select a valid start and destination from the autocomplete options.");
        return;
    }

    const path = findFastestRoute(startNode.id, destinationNode.id);
    if (!path) {
        alert("No route found between these locations.");
        return;
    }

    // Clear existing route
    clearRoute();

    // Draw route
    const latlngs = [map.unproject([startNode.x, startNode.y], nativeZoom)];
    let totalDistance = 0;
    let totalTime = 0;

    path.forEach(step => {
        const node = mapData.nodes.find(n => n.id === step.to);
        latlngs.push(map.unproject([node.x, node.y], nativeZoom));
        totalDistance += step.edge.distance;
        totalTime += step.edge.distance / (step.edge.speed || 40);
    });

    const polyline = L.polyline(latlngs, { color: 'var(--color-primary)', weight: 5 }).addTo(map);
    const startMarker = L.marker(latlngs[0], {
        icon: L.divIcon({
            html: '<i data-lucide="navigation" style="color: var(--color-success);"></i>',
            className: 'custom-marker',
            iconSize: [24, 24],
            iconAnchor: [12, 12]
        })
    }).addTo(map);
    const endMarker = L.marker(latlngs[latlngs.length - 1], {
        icon: L.divIcon({
            html: '<i data-lucide="map-pin" style="color: var(--color-danger);"></i>',
            className: 'custom-marker',
            iconSize: [24, 24],
            iconAnchor: [12, 12]
        })
    }).addTo(map);

    routeLayers.push(polyline, startMarker, endMarker);
    lucide.createIcons();

    // Show Directions
    const directionsDropdown = document.getElementById('directions-dropdown');
    directionsDropdown.style.display = 'block';
    directionsDropdown.classList.add('open');

    document.getElementById('route-distance').textContent = `${totalDistance.toFixed(2)} units`;
    document.getElementById('route-time').textContent = `${(totalTime * 60).toFixed(1)} mins (est)`;

    const stepsList = document.getElementById('directions-steps');
    stepsList.innerHTML = '';
    const directions = generateDirections(path);
    directions.forEach(text => {
        const div = document.createElement('div');
        div.className = 'step-item';
        div.innerHTML = `<i data-lucide="circle" class="step-icon"></i><span>${text}</span>`;
        stepsList.appendChild(div);
    });
    lucide.createIcons();

    map.fitBounds(polyline.getBounds(), { padding: [50, 50] });
});

function clearRoute() {
    routeLayers.forEach(layer => map.removeLayer(layer));
    routeLayers = [];
    document.getElementById('directions-dropdown').style.display = 'none';
}

document.getElementById('clear-route').addEventListener('click', (e) => {
    e.stopPropagation();
    clearRoute();
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
