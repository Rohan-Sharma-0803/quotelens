// Wraps the tesseract worker so the English language data comes from a bundled script
// instead of a separate download (works on any static host).
importScripts('lang/eng-data.js');
const realFetch = self.fetch.bind(self);
self.fetch = (url, opts) => {
  if (String(url).includes('eng.traineddata')) {
    const bin = atob(self.QL_ENG_GZ);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return Promise.resolve(new Response(bytes));
  }
  return realFetch(url, opts);
};
importScripts('worker.min.js');
