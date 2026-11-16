/* Zonsopkomst/-ondergang (NOAA-benadering), offline. Geeft Date-objecten of null (poolnacht/-dag). */
function sunTimes(date, lat, lon){
  const rad = Math.PI / 180, day = 86400000;
  const J1970 = 2440588, J2000 = 2451545;
  const toJ = d => d.valueOf() / day - 0.5 + J1970, fromJ = j => new Date((j + 0.5 - J1970) * day);
  const d = toJ(date) - J2000;
  const lw = -lon * rad, phi = lat * rad, e = rad * 23.4397;
  const n = Math.round(d - 0.0009 - lw / (2 * Math.PI));
  const ds = 0.0009 + lw / (2 * Math.PI) + n;
  const M = rad * (357.5291 + 0.98560028 * ds);
  const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + rad * 102.9372 + Math.PI;
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const Jnoon = J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const h0 = -0.833 * rad;
  const cosw = (Math.sin(h0) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
  if(cosw < -1 || cosw > 1) return {rise:null, set:null, noon:fromJ(Jnoon), polar: cosw < -1 ? 'day' : 'night'};
  const w = Math.acos(cosw);
  const Jset = J2000 + 0.0009 + (w + lw) / (2 * Math.PI) + n + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const Jrise = Jnoon - (Jset - Jnoon);
  return {rise:fromJ(Jrise), set:fromJ(Jset), noon:fromJ(Jnoon)};
}
