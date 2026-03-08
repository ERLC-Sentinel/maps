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

// Creation Mode State
let creationModeEnabled = false;
let creationData = { nodes: [], edges: [] };
let creationLayers = [];
let edgeStartNode = null;
let pendingNodeData = null;

// Load creation data from localStorage
const savedCreationData = localStorage.getItem('creation-mapping');
if (savedCreationData) {
    try {
        creationData = JSON.parse(savedCreationData);
    } catch (e) {
        console.error("Error parsing creation-mapping from localStorage", e);
    }
}

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
    const devModeToggle = document.getElementById('dev-mode-toggle');
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

    devModeToggle.addEventListener('change', (e) => {
        if (e.target.checked && creationModeEnabled) {
            creationToggle.checked = false;
            creationModeEnabled = false;
            updateCreationModeVisibility();
        }
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

    // Handle map clicks for Creation Mode
    map.getContainer().addEventListener('mousedown', (e) => {
        if (!creationModeEnabled) return;

        const latlng = map.mouseEventToLatLng(e);
        const pixelPoint = map.project(latlng, nativeZoom);
        const x = parseFloat(pixelPoint.x.toFixed(2));
        const y = parseFloat(pixelPoint.y.toFixed(2));

        if (e.button === 1) { // Middle click: Building
            e.preventDefault();
            showCreationModal('building', { x, y });
        }
    });

    map.on('contextmenu', (e) => {
        if (e.originalEvent) {
            e.originalEvent.preventDefault();
        }

        if (creationModeEnabled) {
            const pixelPoint = map.project(e.latlng, nativeZoom);
            const x = parseFloat(pixelPoint.x.toFixed(2));
            const y = parseFloat(pixelPoint.y.toFixed(2));

            if (e.originalEvent.shiftKey) {
                // Shift + Right Click: Intersection
                showCreationModal('intersection', { x, y });
            } else if (e.originalEvent.ctrlKey) {
                // Ctrl + Right Click: Edge selection
                handleEdgeSelection(e.latlng);
            }
        } else {
            // Default Right Click behavior
            const pixelPoint = map.project(e.latlng, nativeZoom);
            const x = pixelPoint.x.toFixed(2);
            const y = pixelPoint.y.toFixed(2);
            const textToCopy = `x: ${x}, y: ${y}`;
            copyToClipboard(textToCopy);

            const dot = L.circleMarker(e.latlng, {
                radius: 5,
                color: 'red',
                fillColor: 'red',
                fillOpacity: 1,
                weight: 0,
                interactive: false
            }).addTo(map);

            setTimeout(() => {
                map.removeLayer(dot);
            }, 1000);
        }
    });
};

// Start loading image
img.src = mapImages.postals; // Use one of the images to get dimensions

// --- Dropdown Functionality ---
document.querySelectorAll('.dropdown-header').forEach(header => {
    header.addEventListener('click', (e) => {
        // If clicking an action icon (like the clear-route X), do not toggle the dropdown
        if (e.target.closest('.action-icon')) {
            return;
        }
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
            if (!edge.oneWay) {
                mapData.adjacencyList[edge.to].push({ to: edge.from, edge });
            }
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

    // Create a local adjacency list to modify for this specific route
    const adjacencyList = {};
    for (const nodeId in mapData.adjacencyList) {
        adjacencyList[nodeId] = [...mapData.adjacencyList[nodeId]];
    }

    // For buildings, ensure we consider the 2 nearest non-POI nodes as entry/exit points
    // This allows POIs to connect to lane-specific nodes or waypoints in high-density data.
    const ensureDynamicEdges = (nodeId) => {
        const node = nodes.find(n => n.id === nodeId);
        if (!node || node.type !== 'poi') return;

        const roadNodes = nodes.filter(n => n.type !== 'poi');
        const sorted = roadNodes.map(target => {
            const dx = target.x - node.x;
            const dy = target.y - node.y;
            return { target, dist: Math.sqrt(dx * dx + dy * dy) };
        }).sort((a, b) => a.dist - b.dist);

        const nearest = sorted.slice(0, 2);

        if (!adjacencyList[nodeId]) adjacencyList[nodeId] = [];

        nearest.forEach(({ target, dist }) => {
            if (!adjacencyList[nodeId].some(e => e.to === target.id)) {
                const edge = { from: nodeId, to: target.id, distance: dist, speed: 25 };
                adjacencyList[nodeId].push({ to: target.id, edge });

                if (!adjacencyList[target.id]) adjacencyList[target.id] = [];
                adjacencyList[target.id] = [...adjacencyList[target.id], { to: nodeId, edge }];
            }
        });
    };

    ensureDynamicEdges(startId);
    ensureDynamicEdges(endId);

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
    let started = false;

    path.forEach((step, index) => {
        const toNode = mapData.nodes.find(n => n.id === step.to);

        // Skip waypoint nodes in directions, unless it's the very last node
        if (toNode.type === 'waypoint' && index !== path.length - 1) return;

        const roadName = toNode.label.includes('&') ? toNode.label.split('&')[0].trim() : toNode.label;

        if (!started) {
            directions.push(`Head towards ${toNode.label}`);
            currentRoad = roadName;
            started = true;
        } else if (index === path.length - 1) {
            directions.push(`Arrive at ${toNode.label}`);
        } else if (index > 0 && toNode.type === 'intersection' && roadName !== currentRoad) {
            directions.push(`Turn onto ${toNode.label}`);
            currentRoad = roadName;
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
        const toNode = mapData.nodes.find(n => n.id === step.to);

        // Add waypoints if they exist
        if (step.edge.waypoints && step.edge.waypoints.length > 0) {
            // Check if we need to reverse waypoints (if traversing edge in reverse)
            const isReverse = step.from === step.edge.to;
            const waypoints = isReverse ? [...step.edge.waypoints].reverse() : step.edge.waypoints;

            waypoints.forEach(wp => {
                latlngs.push(map.unproject([wp[0], wp[1]], nativeZoom));
            });
        }

        latlngs.push(map.unproject([toNode.x, toNode.y], nativeZoom));
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
    const dropdown = document.getElementById('directions-dropdown');
    dropdown.style.display = 'none';
    dropdown.classList.remove('open');
}

document.body.addEventListener('click', (e) => {
    if (e.target && (e.target.id === 'clear-route' || e.target.closest('#clear-route'))) {
        e.preventDefault();
        e.stopPropagation();
        clearRoute();
    }
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

// --- Creation Mode Logic ---

const creationToggle = document.getElementById('creation-mode-toggle');
const openCreationDataBtn = document.getElementById('open-creation-data-btn');
const modalOverlay = document.getElementById('modal-overlay');
const creationModal = document.getElementById('creation-modal');
const dataModal = document.getElementById('data-modal');
const modalTitle = document.getElementById('modal-title');
const buildingFields = document.getElementById('building-fields');
const intersectionFields = document.getElementById('intersection-fields');
const edgeFields = document.getElementById('edge-fields');
const modalSave = document.getElementById('modal-save');
const modalCancel = document.getElementById('modal-cancel');
const closeModalBtns = document.querySelectorAll('.close-modal');

creationToggle.addEventListener('change', (e) => {
    creationModeEnabled = e.target.checked;
    updateCreationModeVisibility();
});

function updateCreationModeVisibility() {
    if (creationModeEnabled) {
        // Disable original map data
        clearRoute();

        // Clear Developer Mode if it was on
        const devModeToggle = document.getElementById('dev-mode-toggle');
        if (devModeToggle.checked) {
            devModeToggle.checked = false;
            if (typeof clearDevModeLayers === 'function') {
                clearDevModeLayers();
            }
        }

        renderCreationData();
    } else {
        clearCreationLayers();
        saveCreationData();
    }
}

function showCreationModal(type, data) {
    pendingNodeData = { type, ...data };
    modalTitle.textContent = type === 'building' ? 'Create Building Node' :
                          type === 'intersection' ? 'Create Intersection Node' :
                          'Create Edge';

    buildingFields.style.display = type === 'building' ? 'block' : 'none';
    intersectionFields.style.display = type === 'intersection' ? 'block' : 'none';
    edgeFields.style.display = type === 'edge' ? 'block' : 'none';

    modalOverlay.style.display = 'flex';
    creationModal.style.display = 'flex';
    dataModal.style.display = 'none';

    // Clear inputs
    document.getElementById('building-label').value = '';
    document.getElementById('building-address').value = '';
    document.getElementById('road-h').value = '';
    document.getElementById('lanes-h').value = '';
    document.getElementById('road-v').value = '';
    document.getElementById('lanes-v').value = '';
    document.getElementById('edge-speed').value = '40';
}

modalCancel.addEventListener('click', () => {
    modalOverlay.style.display = 'none';
    pendingNodeData = null;
});

closeModalBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        modalOverlay.style.display = 'none';
        pendingNodeData = null;
    });
});

modalSave.addEventListener('click', () => {
    if (!pendingNodeData) return;

    if (pendingNodeData.type === 'building') {
        const label = document.getElementById('building-label').value.trim();
        const address = document.getElementById('building-address').value.trim();
        if (!label) return alert("Label is required");

        const id = label.toLowerCase().replace(/\s+/g, '-');
        const node = {
            id,
            x: pendingNodeData.x,
            y: pendingNodeData.y,
            label,
            address,
            type: 'poi'
        };
        creationData.nodes.push(node);
    } else if (pendingNodeData.type === 'intersection') {
        const roadH = document.getElementById('road-h').value.trim();
        const roadV = document.getElementById('road-v').value.trim();
        const lanesH = parseInt(document.getElementById('lanes-h').value);
        const lanesV = parseInt(document.getElementById('lanes-v').value);

        if (!roadH || !roadV) return alert("Both roads are required");

        const label = `${roadH} & ${roadV}`;
        const id = label.toLowerCase().replace(/\s+/g, '-');
        const node = {
            id,
            x: pendingNodeData.x,
            y: pendingNodeData.y,
            label,
            type: 'intersection',
            h_lanes: lanesH,
            v_lanes: lanesV
        };
        creationData.nodes.push(node);
    } else if (pendingNodeData.type === 'edge') {
        const speed = parseInt(document.getElementById('edge-speed').value);
        if (isNaN(speed)) return alert("Invalid speed");

        const fromNode = creationData.nodes.find(n => n.id === pendingNodeData.from);
        const toNode = creationData.nodes.find(n => n.id === pendingNodeData.to);

        const dx = toNode.x - fromNode.x;
        const dy = toNode.y - fromNode.y;
        const distance = parseFloat(Math.sqrt(dx * dx + dy * dy).toFixed(2));

        const edge = {
            from: pendingNodeData.from,
            to: pendingNodeData.to,
            distance,
            speed,
            oneWay: false,
            waypoints: []
        };
        creationData.edges.push(edge);
    }

    saveCreationData();
    renderCreationData();
    modalOverlay.style.display = 'none';
    pendingNodeData = null;
});

function handleEdgeSelection(latlng) {
    // Find nearest node in creationData
    let nearest = null;
    let minDist = 20; // 20 units threshold

    creationData.nodes.forEach(node => {
        const nodeLatLng = map.unproject([node.x, node.y], nativeZoom);
        const d = map.distance(latlng, nodeLatLng); // This is meters, let's use pixel dist

        const p1 = map.project(latlng, nativeZoom);
        const p2 = L.point(node.x, node.y);
        const dist = p1.distanceTo(p2);

        if (dist < minDist) {
            minDist = dist;
            nearest = node;
        }
    });

    if (!nearest) return;

    if (!edgeStartNode) {
        edgeStartNode = nearest;
        // Visual feedback
        const marker = creationLayers.find(l => l.options && l.options.nodeId === nearest.id);
        if (marker) marker.setStyle({ color: 'var(--color-warning)' });
    } else {
        if (edgeStartNode.id === nearest.id) {
            edgeStartNode = null;
            renderCreationData();
            return;
        }
        showCreationModal('edge', { from: edgeStartNode.id, to: nearest.id });
        edgeStartNode = null;
    }
}

function renderCreationData() {
    clearCreationLayers();
    if (!creationModeEnabled) return;

    creationData.nodes.forEach(node => {
        const latlng = map.unproject([node.x, node.y], nativeZoom);
        const marker = L.circleMarker(latlng, {
            radius: 6,
            color: node.type === 'poi' ? 'var(--color-info)' : 'var(--color-success)',
            fillColor: node.type === 'poi' ? 'var(--color-info)' : 'var(--color-success)',
            fillOpacity: 0.8,
            weight: 2,
            nodeId: node.id
        }).addTo(map);

        marker.bindTooltip(node.label, { permanent: false, direction: 'top' });
        creationLayers.push(marker);
    });

    creationData.edges.forEach(edge => {
        const fromNode = creationData.nodes.find(n => n.id === edge.from);
        const toNode = creationData.nodes.find(n => n.id === edge.to);
        if (fromNode && toNode) {
            const latlngs = [
                map.unproject([fromNode.x, fromNode.y], nativeZoom),
                map.unproject([toNode.x, toNode.y], nativeZoom)
            ];
            const polyline = L.polyline(latlngs, {
                color: 'var(--color-primary)',
                weight: 3,
                opacity: 0.7
            }).addTo(map);
            creationLayers.push(polyline);
        }
    });
}

function clearCreationLayers() {
    creationLayers.forEach(l => map.removeLayer(l));
    creationLayers = [];
}

function saveCreationData() {
    localStorage.setItem('creation-mapping', JSON.stringify(creationData, null, 2));
}

openCreationDataBtn.addEventListener('click', () => {
    const output = document.getElementById('creation-data-output');
    output.value = JSON.stringify(creationData, null, 2);

    modalOverlay.style.display = 'flex';
    creationModal.style.display = 'none';
    dataModal.style.display = 'flex';
});

document.getElementById('close-data-modal').addEventListener('click', () => {
    modalOverlay.style.display = 'none';
});

document.getElementById('copy-data-btn').addEventListener('click', () => {
    const output = document.getElementById('creation-data-output');
    copyToClipboard(output.value);
    alert("Copied to clipboard!");
});
