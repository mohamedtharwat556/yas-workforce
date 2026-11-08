// ضغط الصور على الموبايل قبل الرفع (توفير الباقة + رفع أسرع)

async function loadBitmap(file) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file)
    } catch {
      // بعض الصيغ (زي HEIC) مش مدعومة — نرجع للأصل
    }
  }
  return await new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = URL.createObjectURL(file)
  })
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
}

// يضغط الصورة: يصغّرها لأقصى بعد maxSize ويقلّل الجودة لحد ما تدخل تحت maxBytes
export async function compressImage(file, { maxSize = 1600, quality = 0.8, maxBytes = 900 * 1024 } = {}) {
  if (!file || !file.type?.startsWith('image/')) return file

  let bitmap
  try {
    bitmap = await loadBitmap(file)
  } catch {
    return file
  }

  const w = bitmap.width || bitmap.naturalWidth
  const h = bitmap.height || bitmap.naturalHeight
  if (!w || !h) return file

  const scale = Math.min(1, maxSize / Math.max(w, h))
  const tw = Math.max(1, Math.round(w * scale))
  const th = Math.max(1, Math.round(h * scale))

  const canvas = document.createElement('canvas')
  canvas.width = tw
  canvas.height = th
  const ctx = canvas.getContext('2d')
  ctx.drawImage(bitmap, 0, 0, tw, th)
  if (bitmap.close) bitmap.close()

  let q = quality
  let blob = await canvasToBlob(canvas, q)
  while (blob && blob.size > maxBytes && q > 0.4) {
    q -= 0.15
    blob = await canvasToBlob(canvas, q)
  }
  if (!blob) return file

  const name = file.name.replace(/\.[^.]+$/, '') + '.jpg'
  return new File([blob], name, { type: 'image/jpeg' })
}
