# Reportes Biomédicos · Intelmedica

App para iPhone (PWA) que genera los informes de mantenimiento F-01-P-SM01 a partir
de los checklists reales de tus 28 plantillas de Drive, con dictado por voz y subida
directa a Google Drive.

## Por qué esto ya no es un solo archivo local

Tus apps anteriores (`rutina.html`, `km-tracker.html`) funcionan como un archivo suelto
abierto en Safari. Esta no puede funcionar así: para que "Conectar Google Drive" sea
automático (Google Sign-In), Google exige que la app viva en una URL https:// real y
registrada, no en un archivo local ni en un link de Dropbox. Por eso son 6 archivos
pensados para alojarse gratis en **GitHub Pages**. Una vez publicada, la agregas a la
pantalla de inicio del iPhone exactamente igual que tus otras apps.

Si en algún momento decides que no vale la pena la subida automática, puedo simplificar
todo esto a un solo HTML con el flujo de "compartir manualmente" que ya conoces — pero
como pediste la opción de Google Sign-In, así es como hay que montarlo.

## Archivos del proyecto

- `index.html` — pantalla y estilos
- `app.js` — toda la lógica (formularios, dictado, PDF, Drive)
- `equipos-data.js` — los 28 checklists extraídos de tus plantillas de Drive
- `manifest.json`, `sw.js`, `icon-192.png`, `icon-512.png` — soporte PWA/offline

## Paso 1 · Publicar en GitHub Pages

1. Crea un repositorio nuevo en GitHub (puede ser privado), por ejemplo `reportes-biomedicos`.
2. Sube estos 7 archivos a la raíz del repositorio (arrastrar y soltar en la web de GitHub funciona).
3. Ve a **Settings → Pages**. En "Build and deployment" elige **Deploy from a branch**,
   rama `main`, carpeta `/root`. Guarda.
4. En un par de minutos GitHub te da una URL como:
   `https://tu-usuario.github.io/reportes-biomedicos/`
   Guárdala, la necesitas en el paso 2.

## Paso 2 · Crear el acceso a Google Drive

1. Entra a [Google Cloud Console](https://console.cloud.google.com/) con la cuenta de
   Gmail donde quieres que se guarden los informes (puede ser la del coordinador de
   mantenimiento de Intelmedica).
2. Crea un proyecto nuevo, por ejemplo "Reportes Intelmedica".
3. Ve a **APIs y servicios → Biblioteca**, busca **Google Drive API** y actívala.
4. Ve a **APIs y servicios → Pantalla de consentimiento OAuth**:
   - Tipo de usuario: **Externo**.
   - Nombre de la app, correo de soporte y de contacto: los tuyos.
   - En "Scopes" agrega `.../auth/drive.file`.
   - En "Usuarios de prueba" agrega tu propio correo de Gmail. Mientras la app esté en
     estado **Testing** (no hace falta publicarla ni verificarla con Google), solo los
     correos que agregues aquí podrán conectar Drive — que es justo lo que quieres para
     un uso interno.
5. Ve a **APIs y servicios → Credenciales → Crear credenciales → ID de cliente de OAuth**:
   - Tipo de aplicación: **Aplicación web**.
   - En "Orígenes de JavaScript autorizados" agrega la URL de GitHub Pages del paso 1,
     **sin la barra final ni la ruta**, por ejemplo: `https://tu-usuario.github.io`
   - Crea y copia el **Client ID** (termina en `.apps.googleusercontent.com`).
6. Abre `app.js`, busca al inicio la línea:
   ```js
   GOOGLE_CLIENT_ID: 'REEMPLAZA_CON_TU_GOOGLE_CLIENT_ID.apps.googleusercontent.com',
   ```
   y pégalo ahí.
7. (Opcional) En Drive crea una carpeta "Informes generados", ábrela, copia el ID que
   aparece en la URL (`drive.google.com/drive/folders/ESTE_ID`) y pégalo en:
   ```js
   DRIVE_FOLDER_ID: '',
   ```
   Si lo dejas vacío, los PDF se guardan en la raíz de "Mi unidad".
8. Vuelve a subir el `app.js` editado a GitHub (reemplaza el archivo en el repositorio).

Nota sobre la sesión de Drive: el token de acceso dura aproximadamente 1 hora. Pasado
ese tiempo, la app simplemente te pedirá tocar "Conectar" de nuevo — no hay que repetir
todo el proceso anterior, es un toque.

## Paso 3 · Instalar en el iPhone

1. Abre la URL de GitHub Pages en **Safari** (no Chrome).
2. Toca el ícono de compartir → **Agregar a pantalla de inicio**.
3. Ábrela desde el ícono nuevo: funciona a pantalla completa, sin barra de Safari.
4. La primera vez que uses el micrófono o "Conectar Drive", el sistema pedirá permiso.

## Cómo se usa

1. **Datos del cliente** (una sola vez por visita): nombre, solicitante, persona a cargo,
   contacto, fecha. Cada campo tiene su botón 🎤 para dictar.
2. **Agregar equipo**: buscas el tipo en el catálogo (los 28 extraídos de tus plantillas,
   o "Otro / personalizado" si no está), llenas marca/modelo/serie/código/ubicación,
   diagnóstico, el checklist específico de ese equipo aparece automáticamente y puedes
   destildar lo que no aplique, observaciones y responsables — todo dictable por voz.
3. Repite el paso 2 para cada equipo intervenido en ese cliente; todos quedan en la lista.
4. **Generar informes**: por cada equipo puedes "Ver / Imprimir / Compartir" (abre el PDF
   en el visor nativo de iOS, desde ahí Compartir → Imprimir o Guardar en Archivos/Drive),
   "Descargar PDF" directo, o "Subir a Drive" con un toque si ya conectaste tu cuenta.

Los datos quedan guardados en el propio iPhone (localStorage) aunque cierres la app, por
si te interrumpen a mitad de una visita.

## Ampliar el catálogo de equipos

Si agregas una plantilla nueva en la carpeta de Drive, ábrela y copia su lista de
"Descripción de los procedimientos realizados" como una entrada nueva en
`equipos-data.js`, siguiendo el mismo formato de las demás. No hace falta tocar nada más.

## Limitaciones a tener en cuenta

- El dictado por voz usa el reconocimiento de voz nativo de Safari/iOS — funciona sin
  instalar nada, pero solo mientras haya conexión a internet.
- El PDF generado replica todos los campos de la plantilla F-01-P-SM01 (datos del
  cliente, equipo, mantenimiento, checklist, observaciones, repuestos y firmas). No
  incluye por ahora la hoja de "Anexo de mediciones cuantitativas" (variable por tipo de
  equipo) ni la ficha de control de cambios — si la necesitas, la agregamos después.
- Mientras la app de Google esté en estado "Testing", solo los correos que agregues como
  "Usuarios de prueba" pueden conectar Drive. Para un uso interno de Intelmedica esto
  normalmente es justo lo que se quiere.
