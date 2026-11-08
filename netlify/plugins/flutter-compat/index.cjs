const { existsSync } = require('node:fs');
const { resolve } = require('node:path');

module.exports = {
  onPreBuild() {
    // Do not silently skip compilation if this becomes a Flutter project later.
    if (existsSync(resolve(process.cwd(), 'pubspec.yaml'))) {
      throw new Error(
        'A Flutter project was detected. Remove the Core AI Flutter compatibility ' +
        'adapter and configure a Flutter SDK and build command for this project.'
      );
    }

    console.warn(
      '[Core AI compatibility adapter] Skipping the site-level netlify-plugin-flutter ' +
      'registration: this static JavaScript app has no Flutter project. ' +
      'No SDK download or git clone is required. Remove the unused registration ' +
      'in Netlify when site settings are accessible.'
    );
  },
};
