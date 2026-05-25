// Mock chrome extension APIs
global.chrome = {
  runtime:  { id: 'abcdefghijklmnopabcdefghijklmnop' },
  tabs:     { query: () => Promise.resolve([]) },
  scripting:{ executeScript: () => Promise.resolve([]) },
  downloads:{ download: () => Promise.resolve(1) },
  declarativeNetRequest: {
    updateSessionRules: () => Promise.resolve(),
  },
};

// Provide the DOM structure popup.js expects so top-level addEventListener calls
// don't throw when the module is required in jsdom.
document.body.innerHTML = `
  <span  id="typeBadge"></span>
  <div   id="pdfSettings"></div>
  <div   id="videoNote"></div>
  <div   id="youtubeFormatPicker"></div>
  <div   id="youtubeFormatList"></div>
  <span  id="youtubeFormatLabel"></span>
  <div   id="resourcePicker"></div>
  <div   id="resourceList"></div>
  <span  id="resourceCount"></span>
  <button id="selectAllBtn"></button>
  <button id="selectNoneBtn"></button>
  <button id="downloadBtn"></button>
  <span  id="btnIcon"></span>
  <span  id="btnText"></span>
  <button id="stopBtn"></button>
  <div   id="logBox"></div>
  <input  id="scaleSlider"   type="range" value="1.0">
  <span  id="scaleVal"></span>
  <input  id="qualitySlider" type="range" value="0.82">
  <span  id="qualityVal"></span>
  <div   id="mainContent"></div>
  <div   id="unsupportedContent"></div>
`;
