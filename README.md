# Salty · link in bio

Web estática (HTML + CSS + JS, sin dependencias). Pesa ~150 KB en total.

```
salty-web/
├── index.html                  ← enlaces y textos
├── css/styles.css              ← colores, tamaños, animaciones
├── js/app.js                   ← contador + ventana de registro  (CONFIG arriba del todo)
├── img/                        ← tus imágenes (sustitúyelas con el mismo nombre)
├── data/followers.json         ← seguidores de respaldo (lo actualiza GitHub solo)
├── api/worker.js               ← API de seguidores en tiempo real (Cloudflare)
├── scripts/update-followers.mjs
└── .github/workflows/update-followers.yml
```

## 1. Personalizar

- **Enlaces**: en `index.html` busca `CAMBIA` (YouTube, Telegram, guía, spreadsheet, zapatillas).
- **Imágenes**: reemplaza los archivos de `img/` manteniendo nombre y proporción
  (cupón 2,06:1 · tarjetas 1:1 · avatar 1:1). Formato recomendado: WebP.
- **Fuente**: tu diseño usa *Agrandir* (de pago). Si tienes licencia, copia
  `Agrandir-Regular.woff2` a `fonts/` y descomenta el bloque del principio de `css/styles.css`.

## 2. Publicar gratis en GitHub Pages

1. Crea una cuenta en <https://github.com> y un repositorio **público** llamado `salty`
   (sin README).
2. Sube los archivos. La forma más sencilla es con **GitHub Desktop**
   (<https://desktop.github.com>): *File → Add local repository* → elige esta carpeta →
   *Publish repository*. O desde una terminal dentro de la carpeta:

   ```bash
   git init && git add . && git commit -m "Primera versión"
   ```
   ```bash
   git branch -M main && git remote add origin https://github.com/TU-USUARIO/salty.git && git push -u origin main
   ```
3. En el repositorio: **Settings → Pages → Build and deployment → Source: Deploy from a branch**,
   rama `main`, carpeta `/ (root)` → **Save**.
4. En 1–2 minutos estará en `https://TU-USUARIO.github.io/salty/`.
5. Pestaña **Actions** → si lo pide, *I understand… enable them* → **Actualizar seguidores**
   → **Run workflow**. A partir de ahí se ejecuta solo cada 30 minutos.

> Cambia la URL de `og:image` en `index.html` por la tuya para que la vista previa
> en WhatsApp/Instagram muestre el cupón.

## 3. Contador en tiempo real (Cloudflare, gratis)

Con el paso 2 el contador ya funciona, pero se actualiza cada ~30 min. Para que sea
en tiempo real (cada 30 s):

1. Crea una cuenta en <https://dash.cloudflare.com> (no pide tarjeta).
2. **Workers & Pages → Create → Worker** → nombre `salty-followers` → **Deploy**.
3. **Edit code** → borra todo, pega el contenido de `api/worker.js` → **Deploy**.
4. Abre la URL que te da (`https://salty-followers.TU-SUBDOMINIO.workers.dev`):
   debe mostrar algo como `{"total":10957,"tiktok":5747,"instagram":5210,…}`.
5. Pega esa URL en `js/app.js` → `CONFIG.apiUrl` y sube el cambio a GitHub.

Si el Worker falla, la web usa automáticamente `data/followers.json`, y si eso también
falla, el último número que vio ese visitante. Nunca se queda en blanco.

## Dominio propio (opcional)

Settings → Pages → *Custom domain*. GitHub te indica los registros DNS a crear.

## Notas

- TikTok e Instagram no tienen API pública de seguidores; se leen de sus páginas públicas.
  Si algún día cambian el formato, hay que ajustar las expresiones de `api/worker.js`.
- GitHub pausa las tareas programadas si un repositorio pasa 60 días sin actividad;
  si el contador deja de moverse, entra en *Actions* y vuelve a activarla.
