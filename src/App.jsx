import { useRef, useState, useMemo, Suspense, useEffect } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, useGLTF, Environment, ContactShadows } from '@react-three/drei'
import { useDrag } from '@use-gesture/react'
import * as THREE from 'three'

const DEFAULT_MATERIAL = { color: '#cccccc', roughness: 0.5, metalness: 0, textureUrl: null, textureScale: 1 }

function encodeScene(placedFurniture) {
  const serializable = placedFurniture.map(item => {
    const mat = { ...item.material }
    // Blob URLs are session-only and won't work in other contexts
    if (mat.textureUrl?.startsWith('blob:')) mat.textureUrl = null
    if (mat.meshMaterials) {
      const mm = {}
      for (const [k, v] of Object.entries(mat.meshMaterials)) {
        mm[k] = v.textureUrl?.startsWith('blob:') ? { ...v, textureUrl: null } : { ...v }
      }
      mat.meshMaterials = mm
    }
    return { ...item, material: mat }
  })
  try {
    return btoa(encodeURIComponent(JSON.stringify(serializable)))
  } catch {
    return null
  }
}

function decodeScene(encoded) {
  try {
    return JSON.parse(decodeURIComponent(atob(encoded)))
  } catch {
    return null
  }
}

function Room() {
  const { scene } = useGLTF('/room.glb')
  
  const clonedScene = useMemo(() => {
    const clone = scene.clone(true)
    clone.traverse((child) => {
      if (child.isMesh) {
        if (Array.isArray(child.material)) {
          child.material = child.material.map(m => {
            const newMat = m.clone()
            newMat.side = THREE.DoubleSide
            return newMat
          })
        } else {
          child.material = child.material.clone()
          child.material.side = THREE.DoubleSide
        }
      }
    })
    return clone
  }, [scene])
  
  return <primitive object={clonedScene} />
}

function DraggableFurniture({ path, position, floorPlane, onDragStart, onDragEnd, isSelected, onSelect, materialSettings, onMeshListUpdate, onPositionChange, isEmbed }) {
  const { scene } = useGLTF(path)
  const meshRef = useRef()
  const pos = useRef(position)
  const offset = useRef([0, 0])
  
  const clonedScene = useMemo(() => scene.clone(true), [scene])
  
  // Get list of meshes and report to parent
  useEffect(() => {
    if (clonedScene && onMeshListUpdate) {
      const meshes = []
      clonedScene.traverse((child) => {
        if (child.isMesh) {
          meshes.push({
            name: child.name || `Mesh ${meshes.length + 1}`,
            uuid: child.uuid
          })
        }
      })
      onMeshListUpdate(meshes)
    }
  }, [clonedScene, onMeshListUpdate])
  
  // Apply materials
  useEffect(() => {
    if (clonedScene && materialSettings) {
      let meshIndex = 0
      
      clonedScene.traverse((child) => {
        if (child.isMesh) {
          // Check if we should apply to this mesh
          const selectedPart = materialSettings.selectedPart || 'all'
          const shouldApply = selectedPart === 'all' || selectedPart === meshIndex.toString()
          
          if (shouldApply) {
            // Get material settings for this specific mesh or use global
            const meshMaterials = materialSettings.meshMaterials || {}
            const settings = meshMaterials[meshIndex] || materialSettings
            
            let texture = null
            if (settings.textureUrl) {
              const loader = new THREE.TextureLoader()
              texture = loader.load(settings.textureUrl)
              texture.wrapS = THREE.RepeatWrapping
              texture.wrapT = THREE.RepeatWrapping
              const scale = settings.textureScale || 1
              texture.repeat.set(scale, scale)
            }
            
            child.material = new THREE.MeshStandardMaterial({
              color: texture ? '#ffffff' : (settings.color || '#cccccc'),
              roughness: settings.roughness !== undefined ? settings.roughness : 0.5,
              metalness: settings.metalness !== undefined ? settings.metalness : 0,
              map: texture,
            })
          }
          
          meshIndex++
        }
      })
    }
  }, [clonedScene, materialSettings])
  
  const bind = useDrag(({ active, first, last, event }) => {
    if (first) {
      onDragStart()
      onSelect()
      if (event.ray) {
        const intersect = new THREE.Vector3()
        event.ray.intersectPlane(floorPlane, intersect)
        offset.current = [
          meshRef.current.position.x - intersect.x,
          meshRef.current.position.z - intersect.z
        ]
      }
    }
    if (last) {
      onDragEnd()
      if (onPositionChange) onPositionChange([...pos.current])
    }
    
    if (active && event.ray) {
      const intersect = new THREE.Vector3()
      event.ray.intersectPlane(floorPlane, intersect)
      pos.current = [
        intersect.x + offset.current[0], 
        position[1], 
        intersect.z + offset.current[1]
      ]
      meshRef.current.position.set(...pos.current)
    }
  }, { pointerEvents: true })

  return (
    <primitive
      ref={meshRef}
      object={clonedScene}
      position={position}
      {...(isEmbed ? {} : bind())}
    />
  )
}

export function Scene({ placedFurniture, selectedId, setSelectedId, isDragging, setIsDragging, onMeshListUpdate, onUpdatePosition, isEmbed }) {
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

  return (
    <>
      <Environment
        preset="studio"
        background={false}
        environmentIntensity={0.1}
      />

      <ContactShadows
        position={[0, 0.01, 0]}
        opacity={0.4}
        scale={20}
        blur={2}
        far={10}
        color="#000000"
      />

      <pointLight
        position={[0, 3, 0]}
        intensity={20}
        color="#fff5e6"
        distance={15}
        decay={2}
      />
      
      <Room />
      
      {placedFurniture.map((item) => (
        <Suspense key={item.instanceId} fallback={null}>
          <DraggableFurniture
            path={item.file}
            position={item.position}
            floorPlane={floorPlane}
            onDragStart={() => setIsDragging(true)}
            onDragEnd={() => setIsDragging(false)}
            isSelected={selectedId === item.instanceId}
            onSelect={() => setSelectedId(item.instanceId)}
            materialSettings={item.material}
            onMeshListUpdate={(meshes) => onMeshListUpdate(item.instanceId, meshes)}
            onPositionChange={(newPos) => onUpdatePosition(item.instanceId, newPos)}
            isEmbed={isEmbed}
          />
        </Suspense>
      ))}
      
      <OrbitControls makeDefault enabled={!isDragging} />
    </>
  )
}

function Sidebar({ furnitureCatalog, onAddFurniture, onDeleteSelected, selectedId, placedFurniture, onUpdateMaterial, meshLists }) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [selectedPart, setSelectedPart] = useState('all')
  const [showEmbed, setShowEmbed] = useState(false)
  const [baseUrl, setBaseUrl] = useState('')
  const [embedWidth, setEmbedWidth] = useState(800)
  const [embedHeight, setEmbedHeight] = useState(600)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setBaseUrl(window.location.origin + window.location.pathname)
  }, [])

  const getIframeCode = () => {
    const encoded = encodeScene(placedFurniture)
    if (!encoded) return '// Scene could not be encoded'
    const src = `${baseUrl.replace(/\/$/, '')}?embed=1#scene=${encoded}`
    return `<iframe\n  src="${src}"\n  width="${embedWidth}"\n  height="${embedHeight}"\n  frameborder="0"\n  allow="fullscreen"\n></iframe>`
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(getIframeCode()).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const [sharing, setSharing] = useState(false)
  const [shareMsg, setShareMsg] = useState(null)

  const handleShareLink = async () => {
    setSharing(true)
    setShareMsg(null)
    try {
      const sceneData = placedFurniture.map(item => {
        const mat = { ...item.material }
        if (mat.textureUrl?.startsWith('blob:')) mat.textureUrl = null
        if (mat.meshMaterials) {
          const mm = {}
          for (const [k, v] of Object.entries(mat.meshMaterials)) {
            mm[k] = v.textureUrl?.startsWith('blob:') ? { ...v, textureUrl: null } : { ...v }
          }
          mat.meshMaterials = mm
        }
        return { ...item, material: mat }
      })
      const res = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scene: JSON.stringify(sceneData) }),
      })
      if (!res.ok) throw new Error('Server error')
      const { id } = await res.json()
      const url = `https://room-demo-nu.vercel.app/view/${id}`
      await navigator.clipboard.writeText(url)
      setShareMsg('Link copied!')
    } catch {
      setShareMsg('Failed — try again')
    } finally {
      setSharing(false)
      setTimeout(() => setShareMsg(null), 3000)
    }
  }
  
  const selectedItem = placedFurniture.find(item => item.instanceId === selectedId)
  const meshList = selectedId ? meshLists[selectedId] || [] : []
  
  // Reset selected part when switching objects
  useEffect(() => {
    setSelectedPart('all')
  }, [selectedId])
  
  // Get current material settings for the selected part
  const getCurrentSettings = () => {
    if (!selectedItem?.material) return DEFAULT_MATERIAL
    
    if (selectedPart === 'all') {
      return selectedItem.material
    } else {
      const meshMaterials = selectedItem.material.meshMaterials || {}
      return meshMaterials[selectedPart] || selectedItem.material
    }
  }
  
  const currentSettings = getCurrentSettings()
  
  // Update material for specific part or all
  const handleMaterialUpdate = (newProps) => {
    if (selectedPart === 'all') {
      onUpdateMaterial(selectedId, {
        ...selectedItem.material,
        ...newProps,
        selectedPart: 'all'
      })
    } else {
      const meshMaterials = { ...(selectedItem.material.meshMaterials || {}) }
      meshMaterials[selectedPart] = {
        ...(meshMaterials[selectedPart] || selectedItem.material),
        ...newProps
      }
      onUpdateMaterial(selectedId, {
        ...selectedItem.material,
        meshMaterials,
        selectedPart
      })
    }
  }
  
  return (
    <div style={{
      position: 'absolute',
      left: 0,
      top: 0,
      width: '240px',
      height: '100vh',
      background: '#1a1a1a',
      padding: '20px',
      boxSizing: 'border-box',
      color: 'white',
      fontFamily: 'Arial, sans-serif',
      overflowY: 'auto',
      zIndex: 100,
    }}>
      <div 
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          padding: '12px',
          background: '#333',
          borderRadius: '6px',
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '4px',
        }}
      >
        <span style={{ fontWeight: 'bold' }}>📦 Furniture</span>
        <span>{isExpanded ? '▼' : '▶'}</span>
      </div>
      
      {isExpanded && (
        <div style={{
          background: '#252525',
          borderRadius: '6px',
          padding: '4px',
          marginBottom: '20px',
        }}>
          {furnitureCatalog.length === 0 ? (
            <div style={{ padding: '12px', color: '#666', fontSize: '13px' }}>
              No furniture found.
            </div>
          ) : (
            furnitureCatalog.map((item) => (
              <div
                key={item.id}
                onClick={() => onAddFurniture(item)}
                style={{
                  padding: '10px 12px',
                  cursor: 'pointer',
                  borderRadius: '4px',
                  fontSize: '14px',
                }}
                onMouseOver={(e) => e.currentTarget.style.background = '#333'}
                onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
              >
                {item.name}
              </div>
            ))
          )}
        </div>
      )}
      
      {placedFurniture.length > 0 && (
        <>
          <div style={{ 
            fontSize: '12px', 
            color: '#888', 
            marginBottom: '8px',
            marginTop: '20px' 
          }}>
            IN SCENE ({placedFurniture.length})
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {placedFurniture.map((item, index) => (
              <div
                key={item.instanceId}
                style={{
                  padding: '10px 12px',
                  background: selectedId === item.instanceId ? '#2a4a6a' : '#252525',
                  borderRadius: '4px',
                  fontSize: '13px',
                }}
              >
                {item.name} #{index + 1}
              </div>
            ))}
          </div>
          
          {selectedId && (
            <button
              onClick={onDeleteSelected}
              style={{
                marginTop: '16px',
                padding: '10px',
                background: '#8B0000',
                border: 'none',
                borderRadius: '6px',
                color: 'white',
                cursor: 'pointer',
                width: '100%',
                fontSize: '13px',
              }}
            >
              🗑️ Delete Selected
            </button>
          )}
        </>
      )}
      
      {/* Embed / iframe generator */}
      <div style={{ marginTop: '40px', borderTop: '1px solid #333', paddingTop: '20px' }}>
        <div style={{ fontSize: '12px', color: '#888', marginBottom: '8px' }}>EMBED</div>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            onClick={() => setShowEmbed(!showEmbed)}
            style={{
              flex: 1,
              padding: '10px',
              background: '#1a3a5c',
              border: 'none',
              borderRadius: '6px',
              color: 'white',
              cursor: 'pointer',
              fontSize: '13px',
            }}
          >
            {showEmbed ? 'Hide iframe' : 'iframe code'}
          </button>
          <button
            onClick={handleShareLink}
            disabled={sharing}
            style={{
              flex: 1,
              padding: '10px',
              background: shareMsg === 'Link copied!' ? '#1a5c2a' : shareMsg ? '#5c1a1a' : '#1a3a5c',
              border: 'none',
              borderRadius: '6px',
              color: 'white',
              cursor: sharing ? 'default' : 'pointer',
              fontSize: '13px',
              opacity: sharing ? 0.7 : 1,
            }}
          >
            {shareMsg ?? (sharing ? 'Sharing…' : 'Share link')}
          </button>
        </div>

        {showEmbed && (
          <div style={{ marginTop: '12px' }}>
            <label style={{ fontSize: '12px', color: '#888' }}>Base URL</label>
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              style={{
                width: '100%',
                padding: '6px',
                marginTop: '4px',
                background: '#333',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                fontSize: '12px',
                boxSizing: 'border-box',
              }}
            />

            <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '12px', color: '#888' }}>Width</label>
                <input
                  type="number"
                  value={embedWidth}
                  onChange={(e) => setEmbedWidth(Number(e.target.value))}
                  style={{
                    width: '100%',
                    padding: '6px',
                    marginTop: '4px',
                    background: '#333',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    fontSize: '12px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '12px', color: '#888' }}>Height</label>
                <input
                  type="number"
                  value={embedHeight}
                  onChange={(e) => setEmbedHeight(Number(e.target.value))}
                  style={{
                    width: '100%',
                    padding: '6px',
                    marginTop: '4px',
                    background: '#333',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    fontSize: '12px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>

            <textarea
              readOnly
              value={getIframeCode()}
              rows={6}
              style={{
                width: '100%',
                marginTop: '8px',
                padding: '8px',
                background: '#111',
                color: '#7ec8e3',
                border: '1px solid #333',
                borderRadius: '4px',
                fontSize: '11px',
                fontFamily: 'monospace',
                resize: 'vertical',
                boxSizing: 'border-box',
              }}
            />

            <button
              onClick={handleCopy}
              style={{
                marginTop: '6px',
                padding: '8px',
                background: copied ? '#1a5c2a' : '#333',
                border: 'none',
                borderRadius: '4px',
                color: 'white',
                cursor: 'pointer',
                width: '100%',
                fontSize: '12px',
              }}
            >
              {copied ? 'Copied!' : 'Copy Code'}
            </button>
          </div>
        )}
      </div>

      {/* Material Editor */}
      {selectedItem && (
        <>
          <div style={{ 
            fontSize: '12px', 
            color: '#888', 
            marginBottom: '8px',
            marginTop: '30px' 
          }}>
            🎨 MATERIAL
          </div>
          
          {/* Part selector */}
          {meshList.length > 1 && (
            <div style={{ marginBottom: '12px' }}>
              <label style={{ fontSize: '12px', color: '#888' }}>Select Part</label>
              <select
                value={selectedPart}
                onChange={(e) => setSelectedPart(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px',
                  marginTop: '4px',
                  background: '#333',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '13px',
                }}
              >
                <option value="all">All Parts</option>
                {meshList.map((mesh, index) => (
                  <option key={mesh.uuid} value={index.toString()}>
                    {mesh.name || `Part ${index + 1}`}
                  </option>
                ))}
              </select>
            </div>
          )}
          
          {/* Color picker */}
          <div style={{ marginBottom: '12px' }}>
            <label style={{ fontSize: '12px', color: '#888' }}>Color</label>
            <input
              type="color"
              value={currentSettings.color || '#cccccc'}
              onChange={(e) => handleMaterialUpdate({ color: e.target.value })}
              style={{
                width: '100%',
                height: '30px',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                marginTop: '4px',
              }}
            />
          </div>
          
          {/* Roughness slider */}
          <div style={{ marginBottom: '12px' }}>
            <label style={{ fontSize: '12px', color: '#888' }}>
              Roughness: {(currentSettings.roughness || 0.5).toFixed(2)}
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={currentSettings.roughness || 0.5}
              onChange={(e) => handleMaterialUpdate({ roughness: parseFloat(e.target.value) })}
              style={{
                width: '100%',
                marginTop: '4px',
              }}
            />
          </div>
          
          {/* Metalness slider */}
          <div style={{ marginBottom: '12px' }}>
            <label style={{ fontSize: '12px', color: '#888' }}>
              Metalness: {(currentSettings.metalness || 0).toFixed(2)}
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={currentSettings.metalness || 0}
              onChange={(e) => handleMaterialUpdate({ metalness: parseFloat(e.target.value) })}
              style={{
                width: '100%',
                marginTop: '4px',
              }}
            />
          </div>
          
          {/* Texture upload */}
          <div style={{ marginBottom: '12px' }}>
            <label style={{ fontSize: '12px', color: '#888' }}>Texture</label>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const file = e.target.files[0]
                if (file) {
                  const url = URL.createObjectURL(file)
                  handleMaterialUpdate({ textureUrl: url })
                }
              }}
              style={{
                width: '100%',
                marginTop: '4px',
                fontSize: '12px',
              }}
            />
            
            {currentSettings.textureUrl && (
              <>
                <button
                  onClick={() => handleMaterialUpdate({ textureUrl: null })}
                  style={{
                    marginTop: '8px',
                    padding: '6px 10px',
                    background: '#444',
                    border: 'none',
                    borderRadius: '4px',
                    color: 'white',
                    cursor: 'pointer',
                    fontSize: '11px',
                    width: '100%',
                  }}
                >
                  Remove Texture
                </button>
                
                <label style={{ fontSize: '12px', color: '#888', marginTop: '12px', display: 'block' }}>
                  Texture Scale: {(currentSettings.textureScale || 1).toFixed(1)}
                </label>
                <input
                  type="range"
                  min="0.1"
                  max="10"
                  step="0.1"
                  value={currentSettings.textureScale || 1}
                  onChange={(e) => handleMaterialUpdate({ textureScale: parseFloat(e.target.value) })}
                  style={{
                    width: '100%',
                    marginTop: '4px',
                  }}
                />
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function App() {
  const isEmbed = new URLSearchParams(window.location.search).get('embed') === '1'

  const [furnitureCatalog, setFurnitureCatalog] = useState([])
  const [placedFurniture, setPlacedFurniture] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [isDragging, setIsDragging] = useState(false)
  const [spawnOffset, setSpawnOffset] = useState(0)
  const [meshLists, setMeshLists] = useState({})

  // Restore scene from URL hash when loaded as an embed
  useEffect(() => {
    const match = window.location.hash.match(/#scene=(.+)/)
    if (match) {
      const decoded = decodeScene(match[1])
      if (decoded) setPlacedFurniture(decoded)
    }
  }, [])

  useEffect(() => {
    fetch('/furniture/manifest.json')
      .then(res => res.json())
      .then(data => {
        const catalog = data.map(item => ({
          ...item,
          file: `/furniture/${item.file}`
        }))
        setFurnitureCatalog(catalog)
      })
      .catch(err => {
        console.log('Could not load furniture manifest:', err)
        setFurnitureCatalog([])
      })
  }, [])
  
  const addFurniture = (catalogItem) => {
    const newItem = {
      ...catalogItem,
      instanceId: `${catalogItem.id}-${Date.now()}`,
      position: [spawnOffset * 0.5, 0, spawnOffset * 0.5],
      material: { ...DEFAULT_MATERIAL, meshMaterials: {} },
    }
    setPlacedFurniture([...placedFurniture, newItem])
    setSpawnOffset((spawnOffset + 1) % 10)
  }
  
  const deleteSelected = () => {
    setPlacedFurniture(placedFurniture.filter(item => item.instanceId !== selectedId))
    setSelectedId(null)
  }
  
  const updateMaterial = (instanceId, newMaterial) => {
    setPlacedFurniture(placedFurniture.map(item => 
      item.instanceId === instanceId 
        ? { ...item, material: newMaterial }
        : item
    ))
  }
  
  const handleMeshListUpdate = (instanceId, meshes) => {
    setMeshLists(prev => ({
      ...prev,
      [instanceId]: meshes
    }))
  }

  const updatePosition = (instanceId, newPosition) => {
    setPlacedFurniture(prev => prev.map(item =>
      item.instanceId === instanceId ? { ...item, position: newPosition } : item
    ))
  }

  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      {!isEmbed && (
        <Sidebar
          furnitureCatalog={furnitureCatalog}
          onAddFurniture={addFurniture}
          onDeleteSelected={deleteSelected}
          selectedId={selectedId}
          placedFurniture={placedFurniture}
          onUpdateMaterial={updateMaterial}
          meshLists={meshLists}
        />
      )}

      <Canvas
        shadows
        camera={{ position: [5, 5, 5], fov: 50 }}
        style={{
          marginLeft: isEmbed ? '0' : '240px',
          width: isEmbed ? '100%' : 'calc(100% - 240px)',
        }}
        gl={{
          antialias: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 0.5
        }}
      >
        <Suspense fallback={null}>
          <Scene
            placedFurniture={placedFurniture}
            selectedId={selectedId}
            setSelectedId={setSelectedId}
            isDragging={isDragging}
            setIsDragging={setIsDragging}
            onMeshListUpdate={handleMeshListUpdate}
            onUpdatePosition={updatePosition}
            isEmbed={isEmbed}
          />
        </Suspense>
      </Canvas>
    </div>
  )
}

export default App