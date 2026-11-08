# Adaptador de compatibilidad para Netlify Build

El sitio tiene una referencia a `strapi-plugin-netlify-deployments` instalada
desde Netlify. El paquete publicado es una extensión de Strapi CMS, carece de
una entrada de módulo para Netlify Build y bloquea el despliegue de esta app.

La dependencia raíz con ese nombre apunta explícitamente a este adaptador local.
Netlify puede resolverlo antes de intentar descargar el plugin incompatible.
El adaptador no ejecuta Strapi ni dispara despliegues: solo muestra un aviso en
`onPreBuild`. No implementa las funciones del plugin original.

El paquete original `strapi-plugin-netlify-deployments@2.0.1` se conserva mediante
el alias npm `strapi-netlify-deployments-upstream` en las dependencias de este
adaptador. No se importa durante el build.

La solución definitiva es quitar la referencia errónea en la configuración del
sitio. Después se puede retirar este adaptador y su dependencia raíz.
