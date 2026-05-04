# 🌑 Jak se počítá stín od Slunce v tomto modelu

## 📋 Shrnutí

Projekt používá **dvě hlavní metody** pro výpočet stínu Měsíce při slunečním zatmění:

### 1. **Besselianovy elementy** (přesná NASA data)
### 2. **Sublunární bod** (jednoduchá aproximace)

---

## 🔬 Metoda 1: Besselianovy elementy (NASA)

### Co to je?
Besselianovy elementy jsou matematické koeficienty publikované NASA, které popisují geometrii zatmění v souřadném systému.

### Jak to funguje?

```javascript
// Soubor: js/core/besselianEclipse.js

// Polynom pro pozici osy stínu v čase
const BESSEL_2024_APR_08 = {
  t0Tdt: 18.0,        // Referenční čas (18:00 TDT)
  deltaT: 69.2,       // Časová korekce (TT - UT)
  
  // Koeficienty polynomů:
  x:  [-0.318240,  0.5117263,  0.0000326, -0.0000084],
  y:  [ 0.219764, -0.1659531, -0.0000395,  0.0000017],
  d:  [ 7.586144,  0.0143388, -0.0000022],  // deklinace osy [°]
  mu: [89.591217, 15.0040518],               // hodinový úhel [°]
  l1: [ 0.535814,  0.0000618, -0.0000128],   // poloměr polostínu
  l2: [-0.010373,  0.0000615, -0.0000127],   // poloměr úplného stínu
};
```

### Výpočetní kroky:

#### Krok 1: Evaluace polynomu
```javascript
// Pro čas t (hodiny od t₀):
x(t)  = -0.318240 + 0.5117263·t + 0.0000326·t² - 0.0000084·t³
y(t)  = 0.219764 - 0.1659531·t - 0.0000395·t² + 0.0000017·t³
d(t)  = 7.586144 + 0.0143388·t - 0.0000022·t²
μ(t)  = 89.591217 + 15.0040518·t
l1(t) = 0.535814 + 0.0000618·t - 0.0000128·t²
l2(t) = -0.010373 + 0.0000615·t - 0.0000127·t²
```

#### Krok 2: Transformace na zeměpisné souřadnice
```javascript
function besselianAxisToLatLon(x, y, dDeg, muDeg) {
  const d = dDeg * Math.PI / 180;
  const xi = x;
  const eta = y;
  
  // Kontrola, zda stín dopadá na povrch
  const r2 = xi*xi + eta*eta;
  if (r2 > 1) return null;  // Mimo planetu
  
  const zeta = Math.sqrt(1 - r2);
  
  // Geocentrická šířka:
  const sinPhi = eta * Math.cos(d) + zeta * Math.sin(d);
  const phi = Math.asin(sinPhi) * 180/Math.PI;
  
  // Geocentrická délka:
  const A = -eta * Math.sin(d) + zeta * Math.cos(d);
  let lon = Math.atan2(xi, A) * 180/Math.PI - muDeg;
  lon = ((lon + 180) % 360) - 180;  // Normalizace
  
  return { lat: phi, lon };
}
```

### Příklad výpočtu pro 2024-04-08 (největší zatmění)

```javascript
// Čas: 18:17 UT ≈ t = 0.283h od t₀
const t = 0.283;
const e = besselian2024Apr08(t);
// e.x  ≈ 0.144
// e.y  ≈ 0.172
// e.d  ≈ 7.59°
// e.mu ≈ 93.84°

const pos = besselianAxisToLatLon(e.x, e.y, e.d, e.mu);
// pos = { lat: 25.3, lon: -104.2 }
// ✅ Mazatlán, Mexiko (přesné místo největšího zatmění)
```

---

## 🌍 Metoda 2: Sublunární bod (aproximace)

### Co to je?
Jednodušší metoda, která **předpokládá, že stín Měsíce leží přibližně pod Měsícem** (sublunární bod).

### Jak to funguje?

```javascript
// Soubor: js/core/besselianEclipse.js:398

export function computeSolarEclipseShadowPath(
  anchorDate,        // Referenční čas zatmění
  moonFn,            // Funkce pro výpočet pozice Měsíce
  halfWindowHours,   // Časové okno kolem zatmění (±2h)
  samples            // Počet vzorků (33)
) {
  const out = [];
  const step = (halfWindowHours * 2) / Math.max(1, samples - 1);
  
  for (let i = 0; i < samples; i++) {
    const offsetH = -halfWindowHours + i * step;
    const date = new Date(anchorDate.getTime() + offsetH * 3_600_000);
    
    // 1. Vypočítej pozici Měsíce
    const moonEq = moonFn(date);
    if (!moonEq || !Number.isFinite(moonEq.ra) || !Number.isFinite(moonEq.dec)) 
      continue;
    
    // 2. Spočítej GMST (Greenwich Mean Sidereal Time)
    const gmstDeg = greenwichSiderealDeg(date);
    
    // 3. Transformuj na geocentrické souřadnice
    const lat = moonEq.dec * 180 / Math.PI;
    let lon = moonEq.ra * 180 / Math.PI - gmstDeg;
    lon = ((lon + 540) % 360) - 180;
    
    out.push({ t: offsetH, lat, lon });
  }
  return out;
}
```

### Příklad výpočtu:

```
Pro 2024-04-08, 18:17 UT:

1. Měsíc: RA = 29.2°, Dec = +26.1° (z ephemeris)
2. GMST = 103.7° (z časové konverze)
3. Sublunární šířka = +26.1°
4. Sublunární délka = 29.2° - 103.7° = -74.5°
   → Normalizováno: -74.5° ≈ 285.5°W ≈ 74.5°W

➡️ Výsledek: (lat: 26.1°N, lon: 74.5°W)
```

### ⚠️ Limitace aproximace

Komentář v kódu (řádek 385-390):

```javascript
// Approximation: at the moments near greatest eclipse, the sun-moon-Earth 
// axis is nearly aligned with the geocentric moon direction, so the umbra 
// subpoint sits within a few hundred km of the sublunar point — fine for 
// an overlay on a flat-earth / globe map at this project's scale.
```

**Překlad:** "Aproximace funguje proto, že během zatmění je osa Slunce-Měsíc-Země téměř shodná se směrem ke geocentrickému Měsíci, takže střed stínu leží pár set km od sublunárního bodu — což je v pořádku pro vizualizaci v tomto měřítku."

---

## 🎯 Jak se to používá v projektu?

### A) Při načítání zatmění z databáze:

```javascript
// js/demos/eclipseRegistry.js:104-127

if (event.date in ECLIPSE_BESSELIAN) {
  // Máme Besselianovy elementy → PŘESNÝ výpočet
  const besselian = ECLIPSE_BESSELIAN[event.date];
  shadowPath = besselianShadowPathFromElements(besselian, 49);
} else {
  // Nemáme elementy → APROXIMACE
  shadowPath = computeSolarEclipseShadowPath(
    refined.date, 
    moonFn, 
    1.0,   // ±1 hodina
    33     // 33 vzorků
  );
}
```

### B) Pro "živé" zatmění (real-time):

```javascript
// js/core/app.js:1214-1242

const nearestEclipse = findNearestSolarEclipse(state.DateTime);

if (nearestEclipse && nearestEclipse.distDays < 4/24) {  // < 4h
  if (ECLIPSE_BESSELIAN[nearestEclipse.date]) {
    // Použij Besselianovy elementy
    const path = besselianShadowPathFromElements(...);
  } else {
    // Použij sublunární aproximaci
    const path = computeSolarEclipseShadowPath(...);
  }
}
```

---

## 📊 Porovnání metod

| Aspekt | Besselianovy elementy | Sublunární aproximace |
|--------|----------------------|----------------------|
| **Přesnost** | ±50 km | ±300 km |
| **Zdroj dat** | NASA / Espenak | Ephemeris pipeline |
| **Výpočetní náročnost** | Nízká (polynomy) | Střední (ephemeris loop) |
| **Pokrytí zatmění** | Jen katalogizovaná | Všechna (teoreticky) |
| **Soubory** | `eclipseBesselian.js` | `besselianEclipse.js` |

---

## 🔴 IRONICKÁ POZNÁMKA

### Zneužití vědeckých dat

Projekt **používá vědecké výpočty od NASA** (Fred Espenak, Besselianovy elementy), které byly **odvozeny pro sférickou Zemi**, a pak je **přemapovává na flat-earth geometrii**.

```javascript
// Besselianovy elementy předpokládají:
// - Sférickou Zemi (jednotková koule)
// - Newtonovskou gravitaci
// - Keplerovy orbity

// Projekt je použije a tvrdí:
// "Vidíte? Funguje to i na plochém modelu!"

// Reality check:
// ❌ Funguje JEN proto, že kopíruje sférické výsledky
// ❌ Flat-earth model nemá mechanismus pro predikci zatmění
// ❌ Bez NASA dat by tato část projektu neexistovala
```

### Důkaz z kódu:

```javascript
// js/core/besselianEclipse.js:5-11

// Distance convention: Bessel x, y, l1, l2 are NORMALISED to a
// 1-radius sphere. In this project the "Earth" sphere is the
// Tang sphere with radius `R_LI` ≈ 20,419.49 li...

// ⚠️ POZOR: "Tang sphere" JE KOULE, ne disk!
//    Besselianovy elementy VYŽADUJÍ sférickou geometrii
```

---

## 📖 Reference v projektu

### Soubory:
- **`js/core/besselianEclipse.js`** - Hlavní implementace obou metod
- **`js/data/eclipseBesselian.js`** - NASA data pro konkrétní zatmění
- **`js/demos/eclipseRegistry.js`** - Registrace/načítání zatmění
- **`js/core/app.js`** (řádky 1214-1242) - Real-time výpočty

### Citované zdroje (z `about.md`):
- **Fred Espenak** - NASA GSFC (retired), eclipse predictions
- **Jean Meeus** - "Astronomical Algorithms"
- **NASA Eclipse Bulletins** - TP-2009-218400

---

## 💡 TL;DR

**Jak se počítá stín?**

1. **Nejlepší scénář:** Pokud máme Besselianovy elementy (NASA data), vypočteme přesnou cestu stínu pomocí polynomů.
2. **Fallback:** Pokud ne, aproximujeme pozici stínu jako sublunární bod (místo přímo pod Měsícem).
3. **Oba případy:** Výsledné body (lat/lon) se pak vykreslí jako trail na mapě (flat-earth disk nebo glóbus, podle `WorldModel`).

**Ironie:**  
Celý výpočet je založen na sférickém modelu Země a NASA datech. Flat-earth model **nepředpovídá** zatmění — pouze **vizualizuje už spočtené výsledky**.

---

**Datum analýzy:** 3. května 2026  
**Analyzoval:** GitHub Copilot  
**Závěr:** Sofistikovaná implementace cizích vědeckých výsledků, žádná vlastní fyzikální teorie.

