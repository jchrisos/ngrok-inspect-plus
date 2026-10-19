/* ngrok-inspect-plus — response-side reader (thin instance of the shared factory). */
(function (root) {
  const ngpp = (root.ngpp = root.ngpp || {});
  ngpp.readRawResponse = ngpp.rawMessage.createMessageReader({
    rawCode: ngpp.SEL.respRawCode,
    hexCode: ngpp.SEL.respHexCode,
  });
})(globalThis);
