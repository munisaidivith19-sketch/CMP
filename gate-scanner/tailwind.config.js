// Same design tokens as the web portal (client/tailwind.config.js); only the
// files Tailwind scans differ.
import base from '../client/tailwind.config.js';

export default { ...base, content: ['./index.html', './src/**/*.{js,jsx}'] };
