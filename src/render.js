const fs = require('fs');
const path = require('path');

function loadTemplates(rootDir) {
  const templateNames = ['display', 'connect', 'not-found'];

  return templateNames.reduce((templates, templateName) => {
    templates[templateName] = fs.readFileSync(
      path.join(rootDir, 'templates', `${templateName}.html`),
      'utf8'
    );
    return templates;
  }, {});
}

function renderTemplate(template, replacements) {
  return Object.entries(replacements).reduce((output, [key, value]) => {
    return output.split(`__${key}__`).join(String(value));
  }, template);
}

module.exports = {
  loadTemplates,
  renderTemplate
};