# Acorde · Cronograma (Power-Up de Trello)

Botón «Cronograma» en la cabecera del tablero que abre un cronograma semanal editable a pantalla completa.
Lee y escribe directamente en los checklists de las tarjetas; no hay base de datos propia.

## Cómo se guardan los datos en Trello

- Cada checklist de una tarjeta es una **fase**: `Presupuesto`, `Básico` (o `Viabilidad`), `Ejecución`, `Dirección de obra`.
- Cada elemento del checklist es una **tarea**: `Nombre · 9/11/26 → 20/11/26` (inicio lunes, entrega viernes).
  Sin fechas → aparece como bloque «?». Marcado → hecha.
- Tarjetas sin etiquetas, checklists ni descripción que empiezan por emoji = separadores de subestado.
- `❓` al final del título = pendiente de revisar.
- Listas ocultas en el cronograma: `HIDDEN_LISTS` en `js/config.js`.

## Estructura

| Archivo | Qué hace |
|---|---|
| `index.html` + `js/connector.js` | Conector: registra el botón del tablero |
| `timeline.html` + `js/app.js` | Interfaz (Preact + htm, sin compilación) |
| `js/model.js` | Tablero ↔ modelo; lectura/escritura del formato de fechas |
| `js/api.js` | Cliente REST de Trello |
| `js/config.js` | API key y ajustes |
| `test/` | Datos de ejemplo y pruebas (`node test/model.test.mjs`) |

## Probar en local

```
python3 -m http.server 8765
```
Abrir `http://localhost:8765/timeline.html?demo` → modo demo con datos de ejemplo; los cambios quedan en memoria.

## Alta en Trello (una vez por Workspace)

1. Publicado en GitHub Pages: `https://sloy.github.io/acorde-trello/` (Settings → Pages → rama `main`, carpeta raíz).
2. En https://trello.com/power-ups/admin → **Nuevo**: elegir el Workspace (hay que ser administrador),
   nombre «Acorde · Cronograma», URL del conector = `https://sloy.github.io/acorde-trello/index.html`.
3. En el Power-Up creado → **API key** → generar. Copiarla en `APP_KEY` de `js/config.js` y volver a publicar.
   En «Allowed origins» añadir el dominio del alojamiento.
4. En **Capabilities** activar solo `board-buttons`.
5. En el tablero: Power-Ups → Personalizados → añadir «Acorde · Cronograma».
6. Cada persona pulsa «Autorizar acceso» la primera vez que abre el cronograma.

Para producción (otro Workspace) se repiten los pasos 2–5 en ese Workspace con la misma URL, o se reutiliza
el Power-Up si se crea directamente allí.
