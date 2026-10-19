/* ngrok-inspect-plus — request-side reader (thin instance of the shared factory). */
(function (root) {
  const ngpp = (root.ngpp = root.ngpp || {});
  ngpp.readRawRequest = ngpp.rawMessage.createMessageReader({
    rawCode: ngpp.SEL.reqRawCode,
    hexCode: ngpp.SEL.reqHexCode,
  });
})(globalThis);
