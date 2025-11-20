"use client"
import { useEffect, useRef } from "react"

type ResampleBias = {
  verticalBoost: number
  horizontalSuppression: number
  jitter: number
}

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stateRef = useRef({
    glContext: null as WebGL2RenderingContext | null,
    program: null as WebGLProgram | null,
    projLoc: null as WebGLUniformLocation | null,
    viewLoc: null as WebGLUniformLocation | null,
    modelLoc: null as WebGLUniformLocation | null,
    posBuffer: null as WebGLBuffer | null,
    time: 0,
    positions: [] as number[],
    morphProgress: 0,
    isMorphing: false,
    isPaused: false,
    pauseTimer: 0,
    particleCount: 5000,
    activeParticleCount: 5000,
    currentPhase: 0,
    spherePositions: [] as number[],
    kingdomPositions: [] as number[],
    museumPositions: [] as number[],
  })

  useEffect(() => {
    if (!canvasRef.current) return

    const canvas = canvasRef.current
    const state = stateRef.current

    state.glContext = canvas.getContext("webgl2", { antialias: true, alpha: false })
    if (!state.glContext) return

    const glContext = state.glContext

    canvas.width = window.innerWidth
    canvas.height = window.innerHeight

    const vertexShader = `#version 300 es
      precision highp float;
      in vec3 position;
      in vec3 color;
      uniform mat4 projection;
      uniform mat4 view;
      uniform mat4 model;
      out vec3 vColor;
      
      void main() {
        gl_Position = projection * view * model * vec4(position, 1.0);
        gl_PointSize = 2.0;
        vColor = color;
      }
    `

    const fragmentShader = `#version 300 es
      precision highp float;
      in vec3 vColor;
      out vec4 outColor;
      
      void main() {
        float dist = length(gl_PointCoord - 0.5);
        if (dist > 0.5) discard;
        float alpha = (1.0 - dist * 2.0) * 0.9;
        outColor = vec4(vColor, alpha);
      }
    `

      const buildSpherePointCloud = (count: number, radius = 2.5) => {
        const positions: number[] = []
        const colors: number[] = []
        const phi = Math.PI * (3 - Math.sqrt(5))

        for (let i = 0; i < count; i++) {
          const y = 1 - (i / Math.max(1, count - 1)) * 2
          const radiusAtY = Math.sqrt(Math.max(0, 1 - y * y))
          const theta = phi * i

          const x = Math.cos(theta) * radiusAtY * radius
          const z = Math.sin(theta) * radiusAtY * radius
          const yScaled = y * radius

          positions.push(x, yScaled, z)

          if (Math.random() < 0.2) {
            colors.push(0.95, 0.88, 0.1)
          } else {
            colors.push(0.85, 0.9, 1.0)
          }
        }

        return { positions, colors }
      }

    function compileShader(source: string, type: number): WebGLShader | null {
      const shader = glContext?.createShader(type)
      if (!shader) return null
      glContext?.shaderSource(shader, source)
      glContext?.compileShader(shader)
      if (!glContext?.getShaderParameter(shader, glContext.COMPILE_STATUS)) {
        console.error("Shader error:", glContext?.getShaderInfoLog(shader))
        return null
      }
      return shader
    }

    const vShader = compileShader(vertexShader, glContext.VERTEX_SHADER)
    const fShader = compileShader(fragmentShader, glContext.FRAGMENT_SHADER)
    if (!vShader || !fShader) return

    state.program = glContext.createProgram()
    if (!state.program) return

    glContext.attachShader(state.program, vShader)
    glContext.attachShader(state.program, fShader)
    glContext.linkProgram(state.program)

    if (!glContext.getProgramParameter(state.program, glContext.LINK_STATUS)) {
      console.error("Program error:", glContext.getProgramInfoLog(state.program))
      return
    }

    const { positions: spherePositions, colors } = buildSpherePointCloud(state.particleCount)
    state.positions = [...spherePositions]
    state.spherePositions = [...spherePositions]
    state.activeParticleCount = state.particleCount

    const posBuffer = glContext.createBuffer()
    glContext.bindBuffer(glContext.ARRAY_BUFFER, posBuffer)
    glContext.bufferData(glContext.ARRAY_BUFFER, new Float32Array(state.positions), glContext.DYNAMIC_DRAW)
    state.posBuffer = posBuffer

    const colorBuffer = glContext.createBuffer()
    glContext.bindBuffer(glContext.ARRAY_BUFFER, colorBuffer)
    glContext.bufferData(glContext.ARRAY_BUFFER, new Float32Array(colors), glContext.STATIC_DRAW)

    glContext["useProgram"](state.program)

    const posLocation = glContext.getAttribLocation(state.program, "position")
    glContext.bindBuffer(glContext.ARRAY_BUFFER, posBuffer)
    glContext.enableVertexAttribArray(posLocation)
    glContext.vertexAttribPointer(posLocation, 3, glContext.FLOAT, false, 0, 0)

    const colorLocation = glContext.getAttribLocation(state.program, "color")
    glContext.bindBuffer(glContext.ARRAY_BUFFER, colorBuffer)
    glContext.enableVertexAttribArray(colorLocation)
    glContext.vertexAttribPointer(colorLocation, 3, glContext.FLOAT, false, 0, 0)

    function perspective(fovy: number, aspect: number, near: number, far: number): Float32Array {
      const out = new Float32Array(16)
      const f = 1.0 / Math.tan(fovy / 2)
      const nf = 1 / (near - far)

      out[0] = f / aspect
      out[1] = 0
      out[2] = 0
      out[3] = 0
      out[4] = 0
      out[5] = f
      out[6] = 0
      out[7] = 0
      out[8] = 0
      out[9] = 0
      out[10] = (far + near) * nf
      out[11] = -1
      out[12] = 0
      out[13] = 0
      out[14] = 2 * far * near * nf
      out[15] = 0

      return out
    }

    function identity(): Float32Array {
      const out = new Float32Array(16)
      out[0] = out[5] = out[10] = out[15] = 1
      return out
    }

    function translate(m: Float32Array, v: [number, number, number]): Float32Array {
      const out = new Float32Array(m)
      out[12] += v[0]
      out[13] += v[1]
      out[14] += v[2]
      return out
    }

    function rotateY(m: Float32Array, angle: number): Float32Array {
      const out = new Float32Array(m)
      const c = Math.cos(angle)
      const s = Math.sin(angle)
      const m0 = out[0],
        m1 = out[1],
        m2 = out[2],
        m3 = out[3],
        m8 = out[8],
        m9 = out[9],
        m10 = out[10],
        m11 = out[11]

      out[0] = m0 * c + m8 * s
      out[1] = m1 * c + m9 * s
      out[2] = m2 * c + m10 * s
      out[3] = m3 * c + m11 * s
      out[8] = m8 * c - m0 * s
      out[9] = m9 * c - m1 * s
      out[10] = m10 * c - m2 * s
      out[11] = m11 * c - m3 * s

      return out
    }

    glContext.clearColor(0.06, 0.06, 0.06, 1.0)
    glContext.enable(glContext.BLEND)
    glContext.blendFunc(glContext.SRC_ALPHA, glContext.ONE)
    glContext.viewport(0, 0, canvas.width, canvas.height)

    const projMatrix = perspective(Math.PI / 3, canvas.width / canvas.height, 0.1, 100)
    state.projLoc = glContext.getUniformLocation(state.program, "projection")
    glContext.uniformMatrix4fv(state.projLoc, false, projMatrix)

    const viewMatrix = translate(identity(), [0, 0, -5])
    state.viewLoc = glContext.getUniformLocation(state.program, "view")
    glContext.uniformMatrix4fv(state.viewLoc, false, viewMatrix)
    state.modelLoc = glContext.getUniformLocation(state.program, "model")

    const loadGLBModel = async (modelPath: string): Promise<number[] | null> => {
      const maxRetries = 3
      const bias: ResampleBias = modelPath.includes("kingdomcentre")
        ? { verticalBoost: 2.2, horizontalSuppression: 0.85, jitter: 0.022 }
        : { verticalBoost: 1.2, horizontalSuppression: 0.45, jitter: 0.016 }
      let lastError: any = null

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          console.log(`[v0] Loading model (attempt ${attempt + 1}):`, modelPath)

          const cacheBuster = `?v=${Date.now()}`
          const response = await fetch(modelPath + cacheBuster, {
            cache: "no-cache",
          })

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`)
          }

          const arrayBuffer = await response.arrayBuffer()

          const dataView = new DataView(arrayBuffer)

          const magic = dataView.getUint32(0, true)
          const version = dataView.getUint32(4, true)
          const length = dataView.getUint32(8, true)

          console.log("[v0] GLB magic:", magic.toString(16), "version:", version, "length:", length)

          if (magic !== 0x46546c67) {
            console.error("[v0] Invalid GLB magic number")
            return null
          }

          let offset = 12
          const chunkLength = dataView.getUint32(offset, true)
          const chunkType = dataView.getUint32(offset + 4, true)
          offset += 8

          if (chunkType !== 0x4e4f534a) {
            console.error("[v0] First chunk is not JSON")
            return null
          }

          const jsonString = new TextDecoder().decode(new Uint8Array(arrayBuffer, offset, chunkLength))
          const gltf = JSON.parse(jsonString)

          console.log("[v0] GLB parsed successfully, has extensions?", gltf.extensionsRequired)

          offset += chunkLength

          const binChunkLength = dataView.getUint32(offset, true)
          const binChunkType = dataView.getUint32(offset + 4, true)
          offset += 8

          if (binChunkType !== 0x004e4942) {
            console.error("[v0] Second chunk is not BIN")
            return null
          }

          const binData = new Uint8Array(arrayBuffer, offset, binChunkLength)

          const mesh = gltf.meshes?.[0]
          if (!mesh) return null

          const primitive = mesh.primitives?.[0]
          if (!primitive) return null

          const positionAccessorIndex = primitive.attributes?.POSITION
          if (positionAccessorIndex === undefined) return null

          const positionAccessor = gltf.accessors?.[positionAccessorIndex]
          if (!positionAccessor) return null

          if (primitive.extensions?.KHR_draco_mesh_compression) {
            console.log("[v0] Draco compression detected - generating procedural geometry")
            const min = positionAccessor.min || [-1, -1, -1]
            const max = positionAccessor.max || [1, 1, 1]
            const count = positionAccessor.count

            const positionsArray: number[] = []
            const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
            const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]]

            for (let i = 0; i < count; i++) {
              const t = i / count
              const layer = Math.floor(t * 30) / 30
              const radius = 0.25 + 0.45 * (1 - layer)

              const angle = t * Math.PI * 2 * 80 + layer * Math.PI * 0.3
              const height = layer

              const x = center[0] + Math.cos(angle) * radius * size[0]
              const y = min[1] + height * size[1]
              const z = center[2] + Math.sin(angle) * radius * size[2]

              positionsArray.push(x, y, z)
            }

              return scaleAndMapPositions(positionsArray, bias)
          }

          console.log("[v0] No Draco compression, extracting real geometry!")

          if (positionAccessor.bufferView === undefined || positionAccessor.bufferView === null) {
            return null
          }

          const bufferViewIndex = positionAccessor.bufferView
          if (!gltf.bufferViews || bufferViewIndex >= gltf.bufferViews.length) {
            return null
          }

          const bufferView = gltf.bufferViews[bufferViewIndex]
          const byteOffset = (bufferView.byteOffset || 0) + (positionAccessor.byteOffset || 0)
          const count = positionAccessor.count

          console.log("[v0] Extracting", count, "vertices from buffer")

          const positionsArray: number[] = []
          const posDataView = new DataView(binData.buffer, binData.byteOffset + byteOffset)

          for (let i = 0; i < count; i++) {
            const x = posDataView.getFloat32(i * 12, true)
            const y = posDataView.getFloat32(i * 12 + 4, true)
            const z = posDataView.getFloat32(i * 12 + 8, true)
            positionsArray.push(x, y, z)
          }

          console.log("[v0] Successfully extracted real geometry!")
            return scaleAndMapPositions(positionsArray, bias)
        } catch (error) {
          lastError = error
          console.error(`[v0] GLB loading error (attempt ${attempt + 1}):`, error)

          if (attempt < maxRetries - 1) {
            await new Promise((resolve) => setTimeout(resolve, 500))
          }
        }
      }

      console.error(`[v0] Failed to load ${modelPath} after ${maxRetries} attempts:`, lastError)
      return null
    }

      const buildSurfaceWeights = (scaledPositions: number[], bias: ResampleBias): number[] => {
        const weights: number[] = []
        const verticalThreshold = 0.35
        const horizontalThreshold = 0.78

        for (let i = 0; i < scaledPositions.length; i += 3) {
          const x = scaledPositions[i]
          const y = scaledPositions[i + 1]
          const z = scaledPositions[i + 2]
          const length = Math.max(Math.hypot(x, y, z), 1e-4)
          const dirY = Math.abs(y / length)

          let weight = 1
          if (dirY < verticalThreshold) {
            const proximity = (verticalThreshold - dirY) / verticalThreshold
            weight *= 1 + proximity * bias.verticalBoost
          } else if (dirY > horizontalThreshold) {
            const intensity = Math.min(1, (dirY - horizontalThreshold) / (1 - horizontalThreshold))
            weight *= Math.max(0.08, 1 - intensity * bias.horizontalSuppression)
          }

          weights.push(weight)
        }

        return weights
      }

      const resampleWithWeights = (
        scaledPositions: number[],
        weights: number[],
        targetCount: number,
        jitterAmount: number,
      ): number[] => {
        if (!scaledPositions.length) {
          return []
        }

        const safeWeights = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0.0001))
        if (!safeWeights.length) {
          return scaledPositions.slice(0, targetCount * 3)
        }

        let totalWeight = safeWeights.reduce((acc, w) => acc + w, 0)
        if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
          totalWeight = safeWeights.length
        }

        const mappedPositions: number[] = []
        const step = totalWeight / targetCount
        let pointer = 0
        let accumulated = safeWeights[0]
        let target = Math.random() * step

        for (let i = 0; i < targetCount; i++) {
          while (pointer < safeWeights.length - 1 && target > accumulated) {
            pointer++
            accumulated += safeWeights[pointer]
          }

          const idx = pointer * 3
          const jitterX = (Math.random() - 0.5) * jitterAmount
          const jitterY = (Math.random() - 0.5) * jitterAmount * 0.7
          const jitterZ = (Math.random() - 0.5) * jitterAmount

          mappedPositions.push(
            scaledPositions[idx] + jitterX,
            scaledPositions[idx + 1] + jitterY,
            scaledPositions[idx + 2] + jitterZ,
          )

          target += step
        }

        return mappedPositions
      }

      const scaleAndMapPositions = (positionsArray: number[], bias: ResampleBias): number[] => {
        if (!positionsArray.length) {
          return [...state.spherePositions]
        }

        let minX = Number.POSITIVE_INFINITY,
          maxX = Number.NEGATIVE_INFINITY
        let minY = Number.POSITIVE_INFINITY,
          maxY = Number.NEGATIVE_INFINITY
        let minZ = Number.POSITIVE_INFINITY,
          maxZ = Number.NEGATIVE_INFINITY

        for (let i = 0; i < positionsArray.length; i += 3) {
          minX = Math.min(minX, positionsArray[i])
          maxX = Math.max(maxX, positionsArray[i])
          minY = Math.min(minY, positionsArray[i + 1])
          maxY = Math.max(maxY, positionsArray[i + 1])
          minZ = Math.min(minZ, positionsArray[i + 2])
          maxZ = Math.max(maxZ, positionsArray[i + 2])
        }

        const centerX = (minX + maxX) / 2
        const centerY = (minY + maxY) / 2
        const centerZ = (minZ + maxZ) / 2
        const maxScale = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1e-4)
        const targetScale = 4.0

        const scaledPositions: number[] = []
        for (let i = 0; i < positionsArray.length; i += 3) {
          scaledPositions.push(
            ((positionsArray[i] - centerX) / maxScale) * targetScale,
            ((positionsArray[i + 1] - centerY) / maxScale) * targetScale,
            ((positionsArray[i + 2] - centerZ) / maxScale) * targetScale,
          )
        }

        const weights = buildSurfaceWeights(scaledPositions, bias)
        const sampled = resampleWithWeights(scaledPositions, weights, state.particleCount, bias.jitter)

        if (!sampled.length) {
          return [...state.spherePositions]
        }

        if (sampled.length < state.particleCount * 3) {
          const fallback = [...sampled]
          const needed = state.particleCount * 3 - sampled.length
          const vertexCount = Math.max(1, Math.floor(sampled.length / 3))
          for (let i = 0; i < needed; i += 3) {
            const vertexIdx = Math.floor((i / 3) % vertexCount)
            const base = vertexIdx * 3
            fallback.push(sampled[base], sampled[base + 1], sampled[base + 2])
          }
          return fallback.slice(0, state.particleCount * 3)
        }

        return sampled.slice(0, state.particleCount * 3)
      }

      const initializeModels = async () => {
        const [kingdom, museum] = await Promise.all([
          loadGLBModel("/images/kingdomcentre.glb"),
          loadGLBModel("/images/museumoffuture.glb"),
        ])

        if (kingdom) {
          state.kingdomPositions = kingdom
          console.log("[v0] Kingdom model loaded:", kingdom.length / 3, "particles")
        } else {
          console.error("[v0] Failed to load kingdom model - falling back to sphere geometry")
          state.kingdomPositions = [...state.spherePositions]
        }

        if (museum) {
          state.museumPositions = museum
          console.log("[v0] Museum model loaded:", museum.length / 3, "particles")
        } else {
          console.error("[v0] Failed to load museum model - falling back to sphere geometry")
          state.museumPositions = [...state.spherePositions]
        }

        setTimeout(() => {
          state.isMorphing = true
          state.currentPhase = 0
        }, 1000)
      }

    initializeModels()

    const animate = () => {
      requestAnimationFrame(animate)
      state.time += 0.0016

      const easeInOutCubic = (t: number): number => {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
      }

      if (state.isMorphing && state.morphProgress < 1) {
        state.morphProgress += 0.0266
        const easedProgress = easeInOutCubic(Math.min(state.morphProgress, 1))

        let fromPositions: number[]
        let toPositions: number[]

        if (state.currentPhase === 0) {
          fromPositions = state.spherePositions
          toPositions = state.kingdomPositions
        } else if (state.currentPhase === 1) {
          fromPositions = state.kingdomPositions
          toPositions = state.museumPositions
        } else {
          fromPositions = state.museumPositions
          toPositions = state.spherePositions
        }

        state.activeParticleCount = state.particleCount

        for (let i = 0; i < state.activeParticleCount; i++) {
          const idx = i * 3
          const fromIdx = idx % fromPositions.length
          const toIdx = idx % toPositions.length

          state.positions[idx] = fromPositions[fromIdx] * (1 - easedProgress) + toPositions[toIdx] * easedProgress
          state.positions[idx + 1] =
            fromPositions[fromIdx + 1] * (1 - easedProgress) + toPositions[toIdx + 1] * easedProgress
          state.positions[idx + 2] =
            fromPositions[fromIdx + 2] * (1 - easedProgress) + toPositions[toIdx + 2] * easedProgress
        }

        const updateLength = state.activeParticleCount * 3
        glContext.bindBuffer(glContext.ARRAY_BUFFER, state.posBuffer)
        glContext.bufferSubData(glContext.ARRAY_BUFFER, 0, new Float32Array(state.positions.slice(0, updateLength)))
      }

      if (state.morphProgress >= 1 && state.isMorphing) {
        state.isMorphing = false
        state.morphProgress = 0
        state.isPaused = true
        state.pauseTimer = 0
      }

      if (state.isPaused) {
        state.pauseTimer += 0.0016
        if (state.pauseTimer >= 0.2) {
          state.isPaused = false

            state.currentPhase = (state.currentPhase + 1) % 3

          state.isMorphing = true
        }
      }

      glContext.clear(glContext.COLOR_BUFFER_BIT | glContext.DEPTH_BUFFER_BIT)

      let modelMatrix = identity()
      modelMatrix = rotateY(modelMatrix, state.time * 0.3)

      glContext["useProgram"](state.program)
      glContext.uniformMatrix4fv(state.viewLoc, false, viewMatrix)
      glContext.uniformMatrix4fv(state.modelLoc, false, modelMatrix)

      glContext.drawArrays(glContext.POINTS, 0, state.activeParticleCount)
    }

    animate()

    const handleResize = () => {
      if (!canvasRef.current || !state.glContext) return

      const canvas = canvasRef.current
      const glContext = state.glContext
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
      glContext.viewport(0, 0, canvas.width, canvas.height)

      const newProjMatrix = perspective(Math.PI / 3, canvas.width / canvas.height, 0.1, 100)
      glContext.uniformMatrix4fv(state.projLoc, false, newProjMatrix)
    }

    window.addEventListener("resize", handleResize)

    return () => {
      window.removeEventListener("resize", handleResize)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-screen block"
      style={{ width: "100vw", height: "100vh", display: "block" }}
    />
  )
}
