// The upstream package is a Strapi CMS extension, not a Netlify Build plugin.
// Keep the stale site-level registration from loading Strapi in this static app.
module.exports = {
  onPreBuild() {
    console.warn(
      '[Core AI compatibility adapter] Skipping the site-level ' +
      'strapi-plugin-netlify-deployments registration: this app does not use Strapi. ' +
      'The upstream Strapi package is retained as strapi-netlify-deployments-upstream. ' +
      'Remove the unused registration in Netlify when site settings are accessible.'
    );
  },
};
