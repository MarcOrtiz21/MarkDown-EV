# MarkDown EV

**MarkDown EV** es un entorno de visualización y edición de Markdown minimalista, de alto rendimiento y grado profesional diseñado específicamente para macOS. Inspirado en la estética limpia de Obsidian, MarkDown EV elimina la necesidad de configurar "vaults" propietarios, permitiendo a los usuarios interactuar de forma nativa con cualquier archivo `.md` o `.txt` del sistema de archivos mediante diálogos tradicionales o arrastrando y soltando archivos sobre la interfaz.

Desarrollado sobre un stack tecnológico moderno que incluye **Electron**, **React**, **Vite** y **CodeMirror 6**, el editor ofrece una experiencia de escritura fluida con renderizado en tiempo real de fórmulas matemáticas complejas (LaTeX), diagramas vectoriales (Mermaid), enlaces relativos de imágenes locales, resaltado sintáctico multilingüe y exportación autónoma a PDF sin conexión.

---

## Características Principales

### 📁 Gestión de Espacio de Trabajo y Archivos
* **Explorador Lateral Jerárquico:** Visualiza directorios locales con un sistema de árbol con carga diferida (lazy loading) e integración nativa de alertas de sistema de archivos (`fs.watch` recursivo en macOS) para reflejar cambios externos instantáneamente.
* **Sistema Multidocumento por Pestañas:** Permite abrir y editar múltiples archivos simultáneamente. Incluye indicadores visuales de modificaciones pendientes y confirmaciones de seguridad para evitar la pérdida accidental de datos.
* **Historial de Documentos Recientes:** Panel de accesos rápidos integrado en la barra lateral que recupera automáticamente los últimos 15 archivos abiertos a través de persistencia local.
* **Auto-guardado Inteligente:** Mecanismo de guardado automático con temporizador de estabilización (debounce de 2 segundos) para evitar interrupciones en la escritura y asegurar la persistencia en disco de manera no invasiva.

### ✍️ Edición y visualización avanzada
* **Motor Markdown de Alta Precisión:** Basado en `markdown-it`, con soporte para extensiones semánticas avanzadas:
  * **LaTeX Matemático:** Renderizado impecable en línea y en bloque a través de `@mdit/plugin-katex`, mitigando conflictos de escape comunes con caracteres especiales.
  * **Diagramas Mermaid:** Visualización de diagramas de flujo y secuencias vectoriales inyectados dinámicamente según el tema de la aplicación.
  * **Listas de Tareas e Hilos:** Checkboxes interactivos y formateados.
  * **Notas al Pie de Página:** Navegación por anclas de referencias bibliográficas.
* **Diseño Dividido Redimensionable:** Panel divisor central interactivo que permite ajustar el ancho del editor y el preview entre un 15% y un 85%.
* **Sincronización de Desplazamiento (Scroll Sync):** Sincronización bidireccional exacta basada en inyección de atributos de línea origen (`data-line`).
* **Pegado Directo de Imágenes (Clipboard Pasting):** Al pegar una imagen (`⌘V`), la aplicación la almacena en una subcarpeta local `./assets/` relativa al documento activo e inyecta la referencia Markdown automáticamente.
* **Búsqueda e Intercambio Nativo:** Panel de búsqueda y reemplazo integrado en el editor (invocado con `⌘F` / `⌘⌥F`).

### 🛠️ UX Nativa de macOS
* **Estética Premium:** Soporte de temas oscuro (One Dark) y claro (One Light) adaptados al esquema del sistema operativo.
* **Margen para Controles de macOS:** Diseño de barra de herramientas optimizado que respeta el espacio de los botones de ventana ("traffic lights") de macOS bajo `hiddenInset` para evitar solapes.
* **Zoom de Interfaz Global:** Escalado homogéneo de la aplicación con los atajos nativos `⌘+`, `⌘-` y `⌘0`.
* **Exportación PDF Autónoma:** Compilación de documentos a formato PDF con inyección inline de recursos CSS para funcionar sin conexión a Internet.

---

## Requisitos del Sistema

* **Entorno de ejecución:** Node.js v20 o superior.
* **Sistema operativo:** macOS (diseño optimizado para arquitectura Apple Silicon y de Intel).

---

## Estructura del Proyecto

```text
├── electron/
│   ├── main.ts         # Proceso principal de Electron (IPCs, watchers, menús y ventanas)
│   └── preload.ts      # Puente seguro de APIs expuestas al renderizador (IPC y webFrame)
├── src/
│   ├── components/     # Componentes React (Editor, Preview, TabBar, FileExplorer, Icons)
│   ├── lib/            # Módulos de lógica (Markdown parser, PDF, atajos y temas)
│   ├── types/          # Archivos de declaraciones TypeScript (.d.ts)
│   ├── App.tsx         # Coordinación central del estado y los atajos globales
│   ├── App.css         # Estilos globales y personalizaciones de temas
│   └── main.tsx        # Punto de entrada de React
├── package.json        # Dependencias y scripts de construcción
└── vite.config.ts      # Configuración de compilación Vite
```

---

## Desarrollo e Instalación

### Instalar dependencias
```bash
npm install
```

### Ejecutar en modo desarrollo
```bash
npm run dev
```

### Compilar y empaquetar para Producción
Para generar el empaquetado nativo (creación de instaladores `.dmg` en la carpeta `release/`):
```bash
npm run dist
```

---

## Atajos de Teclado Globales

| Acción | Atajo |
|--------|-------|
| **Abrir archivo** | `⌘O` |
| **Guardar cambios** | `⌘S` |
| **Guardar archivo como** | `⌘⇧S` |
| **Nueva pestaña** | `⌘T` |
| **Cerrar pestaña activa** | `⌘W` |
| **Exportar a PDF** | `⌘P` |
| **Modo solo Editor** | `⌘1` |
| **Modo Vista Dividida** | `⌘2` |
| **Modo solo Vista Previa** | `⌘3` |
| **Aumentar Zoom** | `⌘+` / `⌘=` |
| **Disminuir Zoom** | `⌘-` |
| **Restablecer Zoom** | `⌘0` |

---

## Stack Tecnológico

* **Electron 40:** Shell del sistema de escritorio.
* **React 18 & Vite 8:** Framework de interfaz de usuario y compilador rápido de módulos.
* **CodeMirror 6:** Editor de texto extensible con resaltado de Markdown.
* **markdown-it:** Parser modular de especificación CommonMark.
* **KaTeX & Mermaid:** Motores matemáticos y diagramación de flujos.
