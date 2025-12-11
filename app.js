// ============================================
// CONFIGURAÇÃO SUPABASE
// ============================================

const SUPABASE_URL = 'https://uiwvxgntqnhxzelnvryx.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVpd3Z4Z250cW5oeHplbG52cnl4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU0NDY3NDcsImV4cCI6MjA4MTAyMjc0N30.5MYCjIewG1aE3Lxr0Ss54OuDcVYYj22MAQB4OO8XTYA'

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// ============================================
// VARIÁVEIS GLOBAIS
// ============================================

let map, markers = {}
let currentUser = null
let myDeviceId = null
let locationWatchId = null
let devices = []
let lastAddressCache = {} // Cache para evitar requests repetidas

// ============================================
// AUTENTICAÇÃO
// ============================================

async function loginWithGoogle() {
  const btn = document.getElementById('googleBtn')
  btn.disabled = true
  btn.innerHTML = '<div class="spinner"></div> Conectando...'
  
  try {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin
      }
    })
    
    if (error) throw error
    
  } catch (error) {
    console.error('Erro no login:', error)
    alert('Erro ao fazer login. Tente novamente.')
    btn.disabled = false
    btn.innerHTML = 'Continuar com Google'
  }
}

async function checkAuth() {
  const { data: { session } } = await supabase.auth.getSession()
  
  if (session) {
    currentUser = session.user
    showApp()
  }
}

function showApp() {
  document.getElementById('loginScreen').classList.add('hidden')
  document.getElementById('appContainer').classList.add('active')
  
  // Atualizar UI com dados do usuário
  const userName = currentUser.user_metadata.full_name || currentUser.email
  const userPhoto = currentUser.user_metadata.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(userName)}&background=6366f1&color=fff`
  
  document.getElementById('userName').textContent = userName.split(' ')[0]
  document.getElementById('userAvatar').src = userPhoto
  
  // Inicializar app
  setTimeout(() => {
    initMap()
    initMyDevice()
    loadDevices()
    startLocationTracking()
  }, 100)
}

async function toggleMenu() {
  if (confirm('Deseja sair da sua conta?')) {
    await supabase.auth.signOut()
    location.reload()
  }
}

// ============================================
// MAPA
// ============================================

function initMap() {
  map = L.map('map', {
    zoomControl: false,
    attributionControl: false
  }).setView([-22.9068, -43.1729], 12) // Rio de Janeiro

  // Mapa com TODAS as ruas detalhadas
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 20, // Zoom máximo aumentado
    minZoom: 3
  }).addTo(map)
  
  // Adicionar controle de zoom personalizado
  L.control.zoom({
    position: 'topright'
  }).addTo(map)
}

function createMarker(device) {
  const icon = L.divIcon({
    className: 'custom-marker-container',
    html: `<div style="
      width: 44px;
      height: 44px;
      border-radius: 50%;
      border: 3px solid ${device.owner_id === currentUser.id ? '#6366f1' : '#22d3ee'};
      overflow: hidden;
      box-shadow: 0 4px 15px rgba(99, 102, 241, 0.4);
      position: relative;
    ">
      <img src="${device.photo_url}" style="width: 100%; height: 100%; object-fit: cover;">
      ${device.owner_id === currentUser.id ? '<div style="position: absolute; bottom: -2px; right: -2px; width: 12px; height: 12px; background: #10b981; border: 2px solid #0f172a; border-radius: 50%;"></div>' : ''}
    </div>`,
    iconSize: [44, 44],
    iconAnchor: [22, 22]
  })

  const marker = L.marker([device.latitude, device.longitude], { icon })
    .addTo(map)
    .bindPopup(`
      <div style="color: #0f172a; min-width: 250px; font-family: 'Plus Jakarta Sans', sans-serif;">
        <div style="border-bottom: 2px solid #6366f1; padding-bottom: 8px; margin-bottom: 10px;">
          <strong style="font-size: 1.2em; color: #1e293b;">${device.name}</strong>
          ${device.owner_id === currentUser.id ? '<span style="background: #6366f1; color: white; padding: 2px 8px; border-radius: 10px; font-size: 0.7em; margin-left: 6px;">VOCÊ</span>' : ''}
        </div>
        
        <div style="background: linear-gradient(135deg, #f1f5f9, #e2e8f0); padding: 12px; border-radius: 8px; margin-bottom: 10px;">
          <div style="font-size: 0.95em; line-height: 1.6; color: #334155;">
            <strong>📍 Localização:</strong><br>
            ${device.last_location || 'Localizando...'}
          </div>
        </div>
        
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 0.85em; color: #64748b;">
          <div>
            <strong>⏱ Atualizado:</strong><br>
            ${formatTime(device.last_update)}
          </div>
          <div>
            <strong>🔋 Bateria:</strong><br>
            ${device.battery}%
          </div>
          <div>
            <strong>🎯 Precisão:</strong><br>
            ${device.accuracy ? device.accuracy + ' metros' : 'N/A'}
          </div>
          <div>
            <strong>📱 Dispositivo:</strong><br>
            ${device.device_name || 'Navegador'}
          </div>
        </div>
        
        <div style="margin-top: 10px; padding-top: 8px; border-top: 1px solid #e2e8f0; font-size: 0.75em; color: #94a3b8;">
          <strong>Coordenadas:</strong> ${device.latitude.toFixed(6)}, ${device.longitude.toFixed(6)}
        </div>
      </div>
    `, {
      maxWidth: 350,
      className: 'custom-popup'
    })
  
  return marker
}

function formatTime(timestamp) {
  const date = new Date(timestamp)
  const now = new Date()
  const diff = Math.floor((now - date) / 1000) // segundos
  
  if (diff < 60) return 'Agora mesmo'
  if (diff < 3600) return `${Math.floor(diff / 60)} min atrás`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h atrás`
  return date.toLocaleDateString('pt-BR') + ' ' + date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

// ============================================
// DISPOSITIVOS
// ============================================

async function initMyDevice() {
  try {
    // Verificar se já existe dispositivo para este usuário
    const { data: existingDevice } = await supabase
      .from('devices')
      .select('*')
      .eq('owner_id', currentUser.id)
      .single()
    
    if (existingDevice) {
      myDeviceId = existingDevice.id
    } else {
      // Criar novo dispositivo
      const deviceName = getDeviceName()
      const userName = currentUser.user_metadata.full_name || currentUser.email
      const userPhoto = currentUser.user_metadata.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(userName)}&background=6366f1&color=fff`
      
      const { data: newDevice, error } = await supabase
        .from('devices')
        .insert([{
          owner_id: currentUser.id,
          name: userName,
          photo_url: userPhoto,
          device_name: deviceName,
          is_online: true
        }])
        .select()
        .single()
      
      if (error) throw error
      myDeviceId = newDevice.id
    }
  } catch (error) {
    console.error('Erro ao inicializar dispositivo:', error)
  }
}

function getDeviceName() {
  const ua = navigator.userAgent
  if (/android/i.test(ua)) {
    const match = ua.match(/Android.*;\s+(.*?)\s+Build/)
    return match ? match[1] : 'Android'
  }
  if (/iPad|iPhone|iPod/.test(ua)) {
    return ua.match(/iPhone/) ? 'iPhone' : 'iPad'
  }
  if (/Windows/.test(ua)) return 'Windows PC'
  if (/Mac/.test(ua)) return 'Mac'
  return 'Navegador'
}

async function loadDevices() {
  try {
    const { data, error } = await supabase
      .from('devices')
      .select('*')
      .eq('is_online', true)
      .order('last_update', { ascending: false })
    
    if (error) throw error
    
    devices = data || []
    updateDevicesList()
    updateMap()
    
  } catch (error) {
    console.error('Erro ao carregar dispositivos:', error)
    document.getElementById('devicesList').innerHTML = `
      <div class="loading">
        <p style="color: var(--danger);">Erro ao carregar dispositivos</p>
      </div>
    `
  }
}

function updateDevicesList() {
  const list = document.getElementById('devicesList')
  const onlineCount = document.getElementById('onlineCount')
  
  if (devices.length === 0) {
    list.innerHTML = `
      <div class="loading">
        <p>Nenhum dispositivo online</p>
      </div>
    `
    onlineCount.textContent = '0 Online'
    return
  }
  
  onlineCount.textContent = `${devices.length} Online`
  
  list.innerHTML = devices.map((device, index) => `
    <div class="device-card ${index === 0 ? 'active' : ''}" onclick="selectDevice(${index})">
      <img class="device-avatar" src="${device.photo_url}" alt="${device.name}">
      <div class="device-info">
        <div class="device-name">${device.name} ${device.owner_id === currentUser.id ? '(Você)' : ''}</div>
        <div class="device-location">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2a8 8 0 0 0-8 8c0 5.4 7 11 8 12 1-1 8-6.6 8-12a8 8 0 0 0-8-8z"/>
          </svg>
          ${device.last_location || 'Localizando...'}
        </div>
      </div>
      <div class="device-meta">
        <div class="device-time">${formatTime(device.last_update)}</div>
        <div class="device-battery">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <rect x="2" y="7" width="18" height="10" rx="2" stroke="currentColor" fill="none" stroke-width="2"/>
            <rect x="4" y="9" width="${Math.floor(device.battery / 100 * 14)}" height="6" fill="currentColor"/>
            <path d="M22 11v2"/>
          </svg>
          ${device.battery}%
        </div>
      </div>
    </div>
  `).join('')
}

function updateMap() {
  // Limpar marcadores antigos
  Object.values(markers).forEach(marker => marker.remove())
  markers = {}
  
  // Adicionar novos marcadores
  devices.forEach(device => {
    if (device.latitude && device.longitude) {
      markers[device.id] = createMarker(device)
    }
  })
  
  // Centralizar no primeiro dispositivo
  if (devices.length > 0 && devices[0].latitude) {
    map.setView([devices[0].latitude, devices[0].longitude], 16)
  }
}

function selectDevice(index) {
  const device = devices[index]
  
  // Atualizar cards
  document.querySelectorAll('.device-card').forEach((card, i) => {
    card.classList.toggle('active', i === index)
  })
  
  // Centralizar mapa
  if (device.latitude && device.longitude) {
    map.flyTo([device.latitude, device.longitude], 18, {
      duration: 1
    })
    
    // Abrir popup do marcador
    if (markers[device.id]) {
      markers[device.id].openPopup()
    }
  }
  
  // Expandir bottom sheet
  document.getElementById('bottomSheet').classList.add('expanded')
}

function toggleSheet() {
  document.getElementById('bottomSheet').classList.toggle('expanded')
}

function centerOnMyLocation() {
  const myDevice = devices.find(d => d.owner_id === currentUser.id)
  if (myDevice && myDevice.latitude) {
    map.flyTo([myDevice.latitude, myDevice.longitude], 18, {
      duration: 1.5
    })
    if (markers[myDevice.id]) {
      markers[myDevice.id].openPopup()
    }
  }
}

// ============================================
// RASTREAMENTO DE LOCALIZAÇÃO - ULTRA PRECISO
// ============================================

function startLocationTracking() {
  if (!navigator.geolocation) {
    console.error('Geolocalização não suportada')
    alert('Seu dispositivo não suporta geolocalização!')
    return
  }
  
  console.log('🎯 Iniciando rastreamento GPS de alta precisão...')
  
  // Configurações PREMIUM de GPS
  const gpsOptions = {
    enableHighAccuracy: true,  // Força uso de GPS satélite
    maximumAge: 0,             // Nunca usa cache
    timeout: 20000             // 20 segundos para pegar melhor sinal
  }
  
  // Primeiro pegamos uma posição inicial
  navigator.geolocation.getCurrentPosition(
    (position) => {
      console.log('✅ GPS ativado! Precisão:', position.coords.accuracy, 'metros')
      updateMyLocation(position)
      
      // Depois iniciamos rastreamento contínuo
      locationWatchId = navigator.geolocation.watchPosition(
        updateMyLocation,
        handleLocationError,
        gpsOptions
      )
    },
    handleLocationError,
    gpsOptions
  )
}

async function updateMyLocation(position) {
  if (!myDeviceId) return
  
  const { latitude, longitude, accuracy } = position.coords
  const battery = await getBatteryLevel()
  
  console.log('📍 Nova localização:', {
    lat: latitude.toFixed(6),
    lng: longitude.toFixed(6),
    accuracy: Math.round(accuracy) + 'm'
  })
  
  try {
    // Obter endereço COMPLETO (reverse geocoding)
    const address = await getAddressFromCoords(latitude, longitude)
    
    // Atualizar no banco de dados
    const { error } = await supabase
      .from('devices')
      .update({
        latitude,
        longitude,
        last_location: address,
        last_update: new Date().toISOString(),
        battery,
        accuracy: Math.round(accuracy),
        is_online: true
      })
      .eq('id', myDeviceId)
    
    if (error) throw error
    
    // Recarregar dispositivos para atualizar UI
    await loadDevices()
    
  } catch (error) {
    console.error('❌ Erro ao atualizar localização:', error)
  }
}

// GEOCODING ULTRA PRECISO - Todas as ruas do mundo
async function getAddressFromCoords(lat, lng) {
  const cacheKey = `${lat.toFixed(5)}_${lng.toFixed(5)}`
  
  // Verificar cache (evita requests repetidas)
  if (lastAddressCache[cacheKey]) {
    return lastAddressCache[cacheKey]
  }
  
  try {
    console.log('🔍 Buscando endereço preciso...')
    
    // API OpenStreetMap Nominatim - MÁXIMA PRECISÃO
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?` +
      `format=json&` +
      `lat=${lat}&` +
      `lon=${lng}&` +
      `zoom=18&` +                    // Zoom máximo = rua com número
      `addressdetails=1&` +           // Detalhes completos
      `extratags=1&` +                // Tags extras
      `accept-language=pt-BR`,        // Idioma português
      {
        headers: {
          'User-Agent': 'SafeTrack Family Tracker App'
        }
      }
    )
    
    if (!response.ok) {
      throw new Error('Erro na API de geocoding')
    }
    
    const data = await response.json()
    const addr = data.address
    
    // Construir endereço COMPLETO E PRECISO
    const parts = []
    
    // 1. RUA/AVENIDA + NÚMERO
    let street = ''
    if (addr.road) {
      street = addr.road
    } else if (addr.pedestrian) {
      street = addr.pedestrian
    } else if (addr.path) {
      street = addr.path
    } else if (addr.footway) {
      street = addr.footway
    }
    
    if (street) {
      if (addr.house_number) {
        parts.push(`${street}, ${addr.house_number}`)
      } else {
        parts.push(street)
      }
    }
    
    // 2. BAIRRO/REGIÃO
    if (addr.neighbourhood) {
      parts.push(addr.neighbourhood)
    } else if (addr.suburb) {
      parts.push(addr.suburb)
    } else if (addr.quarter) {
      parts.push(addr.quarter)
    } else if (addr.hamlet) {
      parts.push(addr.hamlet)
    }
    
    // 3. CIDADE
    if (addr.city) {
      parts.push(addr.city)
    } else if (addr.town) {
      parts.push(addr.town)
    } else if (addr.village) {
      parts.push(addr.village)
    } else if (addr.municipality) {
      parts.push(addr.municipality)
    }
    
    // 4. ESTADO (só em caso de cidades pequenas)
    if (parts.length < 3 && addr.state) {
      parts.push(addr.state)
    }
    
    let fullAddress = parts.join(', ')
    
    // Fallback: Se não conseguiu endereço, usa coordenadas
    if (!fullAddress || fullAddress.length < 10) {
      fullAddress = `${lat.toFixed(6)}, ${lng.toFixed(6)}`
    }
    
    // Salvar no cache
    lastAddressCache[cacheKey] = fullAddress
    
    console.log('✅ Endereço encontrado:', fullAddress)
    console.log('📋 Dados completos:', addr)
    
    return fullAddress
    
  } catch (error) {
    console.error('❌ Erro ao obter endereço:', error)
    // Em caso de erro, retorna coordenadas
    return `${lat.toFixed(6)}, ${lng.toFixed(6)}`
  }
}

async function getBatteryLevel() {
  try {
    if ('getBattery' in navigator) {
      const battery = await navigator.getBattery()
      return Math.round(battery.level * 100)
    }
  } catch (error) {
    console.error('Erro ao obter bateria:', error)
  }
  return 100
}

function handleLocationError(error) {
  console.error('❌ Erro de geolocalização:', error)
  
  switch(error.code) {
    case error.PERMISSION_DENIED:
      alert('⚠️ PERMISSÃO NEGADA!\n\nPor favor, permita o acesso à localização nas configurações do navegador para usar o SafeTrack.')
      break
    case error.POSITION_UNAVAILABLE:
      console.error('Localização indisponível - GPS pode estar desligado')
      alert('⚠️ GPS indisponível!\n\nVerifique se:\n• O GPS está ativado\n• Você está ao ar livre\n• O dispositivo tem sinal de satélite')
      break
    case error.TIMEOUT:
      console.error('Timeout ao obter localização')
      break
  }
}

// ============================================
// REALTIME - UPDATES AUTOMÁTICOS
// ============================================

function setupRealtime() {
  const channel = supabase.channel('device-updates')
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'devices'
      },
      (payload) => {
        console.log('🔄 Dispositivo atualizado:', payload.new)
        
        // Atualizar lista de dispositivos
        const index = devices.findIndex(d => d.id === payload.new.id)
        if (index !== -1) {
          devices[index] = payload.new
        } else {
          devices.push(payload.new)
        }
        
        updateDevicesList()
        
        // Atualizar marcador no mapa
        if (markers[payload.new.id]) {
          markers[payload.new.id].remove()
        }
        if (payload.new.latitude && payload.new.longitude) {
          markers[payload.new.id] = createMarker(payload.new)
        }
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'devices'
      },
      (payload) => {
        console.log('➕ Novo dispositivo:', payload.new)
        devices.push(payload.new)
        updateDevicesList()
        if (payload.new.latitude && payload.new.longitude) {
          markers[payload.new.id] = createMarker(payload.new)
        }
      }
    )
    .subscribe()
}

// ============================================
// INICIALIZAÇÃO
// ============================================

document.addEventListener('DOMContentLoaded', () => {
  checkAuth()
  
  // Listener para mudanças de autenticação
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN') {
      currentUser = session.user
      showApp()
      setupRealtime()
    } else if (event === 'SIGNED_OUT') {
      location.reload()
    }
  })
})

// Cleanup quando sair
window.addEventListener('beforeunload', () => {
  if (locationWatchId) {
    navigator.geolocation.clearWatch(locationWatchId)
  }
})