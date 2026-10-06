/* Enlaces de los chats según el país del visitante.
   Lo usan la página principal (botón de Telegram) y /chats/ (respaldo). */
(function () {
  var LINKS = {
    hispano: 'https://t.me/addlist/Epf3JZL3YQ4yN2Q0', // ES, MX, AR, PE, EC, CO
    resto:   'https://t.me/addlist/YAN-SroiRYVlNWVh', // cualquier otro país
  };
  var HISPANO = ['ES', 'MX', 'AR', 'PE', 'EC', 'CO'];

  // País por IP (lo da Cloudflare). Si no responde, se adivina por la zona horaria.
  var COUNTRY_API = 'https://salty-followers.ardentcone.workers.dev/country';
  var HISPANO_TZ = /^(Europe\/Madrid|Atlantic\/Canary|Africa\/Ceuta|America\/(Mexico_City|Cancun|Merida|Monterrey|Matamoros|Chihuahua|Ciudad_Juarez|Ojinaga|Mazatlan|Bahia_Banderas|Hermosillo|Tijuana|Argentina\/.+|Buenos_Aires|Cordoba|Lima|Guayaquil|Bogota)|Pacific\/Galapagos)$/;

  function byTimezone() {
    try { return HISPANO_TZ.test(Intl.DateTimeFormat().resolvedOptions().timeZone); }
    catch (e) { return true; }
  }

  function linkFor(country) {
    var hispano = country ? HISPANO.indexOf(String(country).toUpperCase()) !== -1 : byTimezone();
    return hispano ? LINKS.hispano : LINKS.resto;
  }

  // Devuelve una promesa con el país (o null), sin esperar nunca más de `ms`
  function getCountry(ms) {
    return new Promise(function (resolve) {
      var t = setTimeout(function () { resolve(null); }, ms || 2500);
      fetch(COUNTRY_API, { cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (d) { clearTimeout(t); resolve((d && d.country) || null); })
        .catch(function () { clearTimeout(t); resolve(null); });
    });
  }

  window.SaltyChats = { linkFor: linkFor, getCountry: getCountry };
})();
