# Adaptador para la referencia de Flutter en Netlify

El sitio tiene `netlify-plugin-flutter` instalado desde Netlify, pero esta app
publica HTML y JavaScript estáticos y utiliza Netlify Functions. No contiene
`pubspec.yaml` ni necesita el SDK de Flutter. El plugin original intenta clonar
ese SDK durante `onPreBuild`, operación que bloquea el despliegue en este entorno.

La dependencia raíz `netlify-plugin-flutter` apunta a este adaptador local para
que Netlify lo resuelva antes que el plugin descargado automáticamente. Acepta
el parámetro `channel` por compatibilidad, pero no instala ni ejecuta Flutter.
Solo muestra un aviso. Si detecta `pubspec.yaml` en el directorio de trabajo,
falla explícitamente para evitar omitir una compilación de Flutter necesaria.

La solución definitiva es quitar la referencia de Flutter desde la configuración
del sitio. Después se puede retirar este adaptador y su dependencia raíz.
