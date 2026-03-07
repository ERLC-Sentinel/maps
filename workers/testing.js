async function test(type) {
   if (type === "map") {
      try {
         const response = await fetch('mapping/mapping.json');
         const data = await response.json();

         const nodeMap = new Map();

         data.nodes.forEach(node => {
            // Ignore the example node
            if (node.id === "ex") return;

            nodeMap.set(node.id, node);

            const latlng = map.unproject([node.x, node.y], nativeZoom);
            const color = node.address ? 'magenta' : 'purple';

            L.circleMarker(latlng, {
               radius: 5,
               color: color,
               fillColor: color,
               fillOpacity: 1,
               weight: 0,
               interactive: true
            })
               .bindTooltip(node.id)
               .on('click', () => {
                  if (navigator.clipboard && window.isSecureContext) {
                     navigator.clipboard.writeText(node.id).catch(err => {
                        console.error("Clipboard error:", err);
                     });
                  } else {
                     const textArea = document.createElement("textarea");
                     textArea.value = node.id;
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
               })
               .addTo(map);
         });

         let visibleEdges = 0;
         if (data.edges) {
            data.edges.forEach(edge => {
               if (edge.from === "ex" || edge.to === "ex") return;

               const fromNode = nodeMap.get(edge.from);
               const toNode = nodeMap.get(edge.to);

               if (fromNode && toNode) {
                  const fromLatLng = map.unproject([fromNode.x, fromNode.y], nativeZoom);
                  const toLatLng = map.unproject([toNode.x, toNode.y], nativeZoom);

                  L.polyline([fromLatLng, toLatLng], {
                     color: 'green',
                     weight: 3,
                     opacity: 0.8,
                     interactive: false
                  }).addTo(map);

                  if (edge.speed !== undefined) {
                     const midLatLng = [
                        (fromLatLng.lat + toLatLng.lat) / 2,
                        (fromLatLng.lng + toLatLng.lng) / 2
                     ];

                     const speedIcon = L.divIcon({
                        className: 'edge-speed-label',
                        html: `<div style="background-color: rgba(0, 0, 0, 0.75); color: white; font-size: 15px; border-radius: 4px; display: flex; justify-content: center; align-items: center; width: 100%; height: 100%;">${edge.speed}</div>`,
                        iconSize: [30, 22],
                        iconAnchor: [15, 11]
                     });

                     L.marker(midLatLng, {
                        icon: speedIcon,
                        interactive: false
                     }).addTo(map);
                  }

                  visibleEdges++;
               }
            });
         }

         console.log(`Added ${data.nodes.length - 1} nodes and ${visibleEdges} edges from mapping.json to the map.`);
      } catch (error) {
         console.error("Failed to fetch or parse mapping.json:", error);
      }
   } else if (type === "mapjson") {
      try {
         const response = await fetch('mapping/mapping.json');
         const data = await response.json();
         console.log(data);
      } catch (error) {
         console.error("Failed to fetch or parse mapping.json:", error);
      }
   }
}