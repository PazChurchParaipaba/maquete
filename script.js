// Estado da aplicação
let waypoints = [
    [-3.3472217, -39.1384822], // Início original (Vanuzio Burguer)
    [-3.348194, -39.137500]    // Fim original
];
let standNames = {}; // Armazena os nomes dados aos stands: { 1: "Nome", 2: "Outro" }
let eliminatedStands = {}; // Armazena os stands eliminados: { 1: true }

const supabaseUrl = 'https://groezaseypdbpgymgpvo.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdyb2V6YXNleXBkYnBneW1ncHZvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYwNjkxNjYsImV4cCI6MjA4MTY0NTE2Nn0.5U5QeoGmZn_i9Y8POoUCkatBUAdSW-cjHRyfxpm_pyM';
const supabase = window.supabase.createClient(supabaseUrl, supabaseKey);

// Função para carregar dados do Supabase
async function loadData() {
    const { data, error } = await supabase
        .from('maquete_state')
        .select('data')
        .eq('id', 1)
        .single();
        
    if (data && data.data && data.data.waypoints) {
        waypoints = data.data.waypoints;
        standNames = data.data.standNames || {};
        eliminatedStands = data.data.eliminatedStands || {};
        updateMap();
        map.fitBounds(waypoints, { padding: [50, 50] });
    }
}
loadData();

// Escuta em tempo real as mudanças no banco
supabase
    .channel('custom-all-channel')
    .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'maquete_state' },
        (payload) => {
            const newData = payload.new.data;
            if (newData && newData.waypoints) {
                waypoints = newData.waypoints;
                standNames = newData.standNames || {};
                eliminatedStands = newData.eliminatedStands || {};
                updateMap(); // Atualiza a tela com os dados do outro usuário
            }
        }
    )
    .subscribe();

// Função para salvar dados no Supabase
function saveData() {
    const data = { waypoints, standNames, eliminatedStands };
    // Envia a atualização em background (fire and forget)
    supabase.from('maquete_state').update({ data: data }).eq('id', 1).then(({error}) => {
        if(error) console.error("Erro ao salvar no Supabase:", error);
    });
}

// Configuração do Mapa
const map = L.map('map').setView([-3.3477, -39.1380], 18);

L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    subdomains: 'abcd',
    maxZoom: 22
}).addTo(map);

// Variáveis para guardar camadas atuais do mapa
let waypointMarkers = [];
let routeLineLayer = null;
let standsLayers = [];

const waypointIcon = L.divIcon({
    className: 'waypoint-icon',
    iconSize: [16, 16],
    iconAnchor: [8, 8]
});

// Adicionar novo ponto ao clicar no mapa
map.on('click', function(e) {
    waypoints.push([e.latlng.lat, e.latlng.lng]);
    saveData();
    updateMap();
});

function updateMap() {
    // Guarda quem estava em foco para não perder ao digitar
    const activeStandNumber = document.activeElement && document.activeElement.tagName === 'INPUT' 
        ? document.activeElement.dataset.stand 
        : null;

    // 1. Limpa o mapa
    waypointMarkers.forEach(m => map.removeLayer(m));
    waypointMarkers = [];
    
    if (routeLineLayer) map.removeLayer(routeLineLayer);
    
    standsLayers.forEach(layer => map.removeLayer(layer));
    standsLayers = [];
    
    document.getElementById('stands-list').innerHTML = '';
    
    if (waypoints.length < 2) {
        document.getElementById('total-distance').textContent = '0m';
        document.getElementById('total-stands').textContent = '0';
        return;
    }

    // 2. Desenha os marcadores arrastáveis
    waypoints.forEach((coord, index) => {
        const marker = L.marker(coord, {
            icon: waypointIcon,
            draggable: true
        }).addTo(map);
        
        // Atualiza a posição ao arrastar
        marker.on('dragend', function(e) {
            const newPos = e.target.getLatLng();
            waypoints[index] = [newPos.lat, newPos.lng];
            saveData();
            updateMap();
        });
        
        // Remove ponto ao clicar com botão direito
        marker.on('contextmenu', function() {
            if (waypoints.length > 2) {
                waypoints.splice(index, 1);
                saveData();
                updateMap();
            } else {
                alert("Você precisa de pelo menos 2 pontos para formar uma rota.");
            }
        });
        
        // Tooltip indicando ordem
        marker.bindTooltip(index === 0 ? "Início" : (index === waypoints.length - 1 ? "Fim" : `Ponto ${index+1}`));
        
        waypointMarkers.push(marker);
    });

    // 3. Constrói a linha com Turf.js (Turf usa [Lng, Lat])
    const lineCoords = waypoints.map(wp => [wp[1], wp[0]]);
    const line = turf.lineString(lineCoords);
    
    routeLineLayer = L.geoJSON(line, {
        style: { color: '#94a3b8', weight: 3, dashArray: '6, 6' }
    }).addTo(map);

    // 4. Calcula distância
    const distanceKm = turf.length(line, {units: 'kilometers'});
    const distanceMeters = distanceKm * 1000;
    document.getElementById('total-distance').textContent = distanceMeters.toFixed(1) + 'm';

    // 5. Calcula e desenha Stands
    const standSize = 3; 
    const spacing = 0.5; // Espaço entre stands
    const stepMeters = standSize + spacing;
    
    const numStands = Math.floor(distanceMeters / stepMeters);
    
    // Atualiza o contador de stands (subtraindo os eliminados)
    let activeStandsCount = 0;
    for (let i = 1; i <= numStands; i++) {
        if (!eliminatedStands[i]) activeStandsCount++;
    }
    document.getElementById('total-stands').textContent = activeStandsCount;

    const standsListContainer = document.getElementById('stands-list');

    for(let i = 0; i < numStands; i++) {
        const distAlong = (i * stepMeters) + (standSize / 2); // Distância até o centro do stand
        
        // Encontra o ponto central do stand na linha
        const alongPoint = turf.along(line, distAlong / 1000, {units: 'kilometers'});
        const centerLon = alongPoint.geometry.coordinates[0];
        const centerLat = alongPoint.geometry.coordinates[1];
        
        // Para calcular a rotação correta (bearing) do stand, pegamos um ponto um pouco à frente na linha
        let bearing = 0;
        if (distAlong / 1000 + 0.0001 < distanceKm) {
            const nextPoint = turf.along(line, (distAlong / 1000) + 0.0001, {units: 'kilometers'});
            bearing = turf.bearing(alongPoint, nextPoint);
        } else {
            // Se for o último stand, pega a rotação do ponto um pouco atrás
            const prevPoint = turf.along(line, (distAlong / 1000) - 0.0001, {units: 'kilometers'});
            bearing = turf.bearing(prevPoint, alongPoint);
        }

        // Desenha o quadrado
        const radiusMeters = 1.5; // 3x3m
        const dLat = radiusMeters / 111320; 
        const dLon = radiusMeters / (111320 * Math.cos(centerLat * Math.PI / 180));
        
        const square = turf.polygon([[
            [centerLon - dLon, centerLat - dLat],
            [centerLon + dLon, centerLat - dLat],
            [centerLon + dLon, centerLat + dLat],
            [centerLon - dLon, centerLat + dLat],
            [centerLon - dLon, centerLat - dLat]
        ]]);
        
        const rotatedSquare = turf.transformRotate(square, bearing, {pivot: alongPoint});
        
        const standNumber = i + 1;
        const currentName = standNames[standNumber] || "";
        const isEliminated = eliminatedStands[standNumber] || false;
        
        // Estilo do polígono
        const styleNormal = {
            color: '#2563eb',
            fillColor: '#3b82f6',
            fillOpacity: 0.5,
            weight: 1.5
        };
        const styleEliminated = {
            color: '#ef4444', // Vermelho
            fillColor: '#fca5a5',
            fillOpacity: 0.4,
            weight: 1.5,
            dashArray: '4, 4'
        };
        
        const layer = L.geoJSON(rotatedSquare, {
            style: isEliminated ? styleEliminated : styleNormal
        }).addTo(map);
        
        standsLayers.push(layer);
        
        // Função para atualizar o popup
        const updatePopup = (name, eliminated) => {
            let status = eliminated ? "<b style='color:red;'>[ELIMINADO]</b><br>" : "";
            const displayName = name.trim() !== "" ? name : "Disponível";
            layer.bindPopup(`${status}<b>Stand ${standNumber}</b><br>Responsável: ${displayName}<br>Distância: ${distAlong.toFixed(1)}m`);
        };
        updatePopup(currentName, isEliminated);
        
        // Cria item na barra lateral
        const listItem = document.createElement('div');
        listItem.className = `stand-item ${isEliminated ? 'eliminated' : ''}`;
        
        const standNumberDiv = document.createElement('div');
        standNumberDiv.className = 'stand-number';
        standNumberDiv.textContent = standNumber;
        
        const standInfo = document.createElement('div');
        standInfo.className = 'stand-info';
        
        const inputField = document.createElement('input');
        inputField.type = 'text';
        inputField.placeholder = `Nome do Stand ${standNumber}`;
        inputField.value = currentName;
        inputField.disabled = isEliminated;
        
        inputField.dataset.stand = standNumber;
        
        // Impede o clique no input de acionar o pan do mapa
        inputField.addEventListener('click', (e) => e.stopPropagation());
        
        // Salva o nome ao digitar e atualiza o popup em tempo real
        inputField.addEventListener('input', (e) => {
            const newName = e.target.value;
            standNames[standNumber] = newName;
            saveData();
            updatePopup(newName, eliminatedStands[standNumber]);
            
            if (layer.isPopupOpen()) {
                layer.getPopup().update();
            }
        });
        
        const standMeta = document.createElement('div');
        standMeta.className = 'stand-meta';
        
        const distText = document.createElement('p');
        distText.textContent = `Distância: ${distAlong.toFixed(1)}m`;
        
        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'toggle-eliminated';
        toggleBtn.textContent = isEliminated ? 'RESTAURAR' : 'ELIMINAR (X)';
        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Não clica na linha inteira
            eliminatedStands[standNumber] = !eliminatedStands[standNumber];
            saveData();
            updateMap(); // Recalcula mapa e contadores
        });
        
        standMeta.appendChild(distText);
        standMeta.appendChild(toggleBtn);
        
        standInfo.appendChild(inputField);
        standInfo.appendChild(standMeta);
        
        listItem.appendChild(standNumberDiv);
        listItem.appendChild(standInfo);
        
        // Interação de clique no item inteiro
        listItem.addEventListener('click', () => {
            document.querySelectorAll('.stand-item').forEach(el => el.classList.remove('active'));
            listItem.classList.add('active');
            
            map.flyTo([centerLat, centerLon], 21, {
                animate: true,
                duration: 1.0
            });
            layer.openPopup();
            inputField.focus(); // Foca automaticamente no campo para digitar
        });
        
        standsListContainer.appendChild(listItem);
    }

    // Restaura o foco do input se alguém estava digitando
    if (activeStandNumber) {
        const inputToFocus = document.querySelector(`input[data-stand="${activeStandNumber}"]`);
        if (inputToFocus) {
            inputToFocus.focus();
            const val = inputToFocus.value;
            inputToFocus.value = '';
            inputToFocus.value = val;
        }
    }
}

// Inicializa a primeira renderização
updateMap();
map.fitBounds(waypoints, { padding: [50, 50] });

// Lógica de Exportar e Importar Backup
document.getElementById('btn-export').addEventListener('click', () => {
    const data = { waypoints, standNames, eliminatedStands };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backup_stands_${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
});

document.getElementById('btn-import').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(evt) {
        try {
            const parsed = JSON.parse(evt.target.result);
            if (parsed.waypoints) waypoints = parsed.waypoints;
            if (parsed.standNames) standNames = parsed.standNames;
            if (parsed.eliminatedStands) eliminatedStands = parsed.eliminatedStands;
            saveData();
            updateMap();
            map.fitBounds(waypoints, { padding: [50, 50] });
            alert("Backup importado com sucesso!");
        } catch(err) {
            alert("Erro ao importar arquivo. Certifique-se de que é um JSON válido.");
        }
    };
    reader.readAsText(file);
    // Limpar o input para permitir importar o mesmo arquivo novamente
    e.target.value = '';
});
