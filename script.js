const DEFAULT_CITY = "Kathmandu";
const STORE_KEY = "nepal-weather-last-city";
const STORE_CITY_ID_KEY = "nepal-weather-last-city-id";
const BAR_MS = 10 * 60 * 1000;
const CATALOG_URL = "./nepal-cities.json";
const MAX_CITIES_PER_REFRESH = 120;

const BAR_CITIES = ["Kathmandu", "Pokhara", "Biratnagar", "Butwal", "Dharan", "Nepalgunj", "Birgunj", "Dhangadhi", "Jumla", "Namche Bazaar"];
const CITY_COORDS = {
  Kathmandu: { latitude: 27.7172, longitude: 85.324 },
  Pokhara: { latitude: 28.2096, longitude: 83.9856 },
  Biratnagar: { latitude: 26.4525, longitude: 87.2718 },
  Butwal: { latitude: 27.7006, longitude: 83.4483 },
  Dharan: { latitude: 26.8125, longitude: 87.2833 },
  Nepalgunj: { latitude: 28.05, longitude: 81.6167 },
  Birgunj: { latitude: 27, longitude: 84.8667 },
  Dhangadhi: { latitude: 28.6833, longitude: 80.6 },
  Jumla: { latitude: 29.2747, longitude: 82.1838 },
  "Namche Bazaar": { latitude: 27.8056, longitude: 86.71 }
};

const el = {
  cityDropdown: document.getElementById("cityDropdown"),
  citySearch: document.getElementById("citySearch"),
  cityToggle: document.getElementById("cityDropdownToggle"),
  cityPanel: document.getElementById("cityDropdownPanel"),
  cityMeta: document.getElementById("cityDropdownMeta"),
  cityOptions: document.getElementById("cityOptions"),
  ticker: document.getElementById("ticker"),
  loading: document.getElementById("loading"),
  error: document.getElementById("error"),
  content: document.getElementById("content"),
  loadAllBtn: document.getElementById("loadAllBtn"),
  allStatus: document.getElementById("allStatus"),
  allFilter: document.getElementById("allFilter"),
  allCitiesBody: document.getElementById("allCitiesBody"),
  prevPage: document.getElementById("prevPage"),
  nextPage: document.getElementById("nextPage"),
  pageInfo: document.getElementById("pageInfo")
};

let reqId = 0;
let cityCatalog = [];
let cityById = new Map();
let cityByName = new Map();
let cityByLabel = new Map();

let liveCityRows = [];
let filteredLiveRows = [];
let currentPage = 1;
const PAGE_SIZE = 100;
const DROPDOWN_LIMIT = 120;
let dropdownMatches = [];
let isLoadingAllCities = false;
let lastTopBarHtml = "";
let replaceSearchOnNextType = true;

const pad = (n) => String(n).padStart(2, "0");

function normalize(text) {
  return (text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function nepalDate(offset) {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kathmandu",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const y = +p.find((x) => x.type === "year").value;
  const m = +p.find((x) => x.type === "month").value;
  const d = +p.find((x) => x.type === "day").value;

  const s = new Date(Date.UTC(y, m - 1, d + offset));
  return `${s.getUTCFullYear()}-${pad(s.getUTCMonth() + 1)}-${pad(s.getUTCDate())}`;
}

function prettyDate(iso) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric"
  }).format(new Date(`${iso}T00:00:00`));
}

function roundValue(n) {
  return typeof n === "number" && !Number.isNaN(n) ? Math.round(n) : "--";
}

function meta(code, isDay = true) {
  let label = "Unknown";
  let type = "cloudy";

  if (code === 0) {
    label = isDay ? "Clear Sky" : "Clear Night";
    type = isDay ? "sunny" : "night";
  } else if (code === 1) {
    label = isDay ? "Mainly Clear" : "Mostly Clear Night";
    type = isDay ? "sunny" : "night";
  } else if (code === 2) {
    label = "Partly Cloudy";
  } else if (code === 3) {
    label = "Overcast";
  } else if ([45, 48].includes(code)) {
    label = "Foggy";
  } else if ([51, 53, 55, 56, 57].includes(code)) {
    label = "Drizzle";
    type = "rainy";
  } else if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) {
    label = "Rainy";
    type = "rainy";
  } else if ([71, 73, 75, 77, 85, 86].includes(code)) {
    label = "Snow";
    type = "snow";
  } else if ([95, 96, 99].includes(code)) {
    label = "Thunderstorm";
    type = "storm";
  }

  return { label, type };
}

function icon(type) {
  if (type === "sunny") return '<div class="icon"><span class="sun"></span><span class="ray"></span></div>';
  if (type === "rainy") return '<div class="icon"><span class="cloud c1"></span><span class="cloud c2"></span><span class="drop d1"></span><span class="drop d2"></span><span class="drop d3"></span></div>';
  if (type === "storm") return '<div class="icon"><span class="cloud c1"></span><span class="cloud c2"></span><span class="bolt"></span></div>';
  if (type === "snow") return '<div class="icon"><span class="cloud c1"></span><span class="cloud c2"></span><span class="snow s1">*</span><span class="snow s2">*</span><span class="snow s3">*</span></div>';
  if (type === "night") return '<div class="icon"><span class="moon"></span><span class="star st1">*</span><span class="star st2">*</span><span class="star st3">*</span></div>';
  return '<div class="icon"><span class="cloud c1"></span><span class="cloud c2"></span></div>';
}

function theme(type, isDay) {
  if (!isDay) {
    document.body.dataset.theme = "night";
    return;
  }

  document.body.dataset.theme = type === "sunny"
    ? "sunny"
    : type === "rainy"
      ? "rainy"
      : type === "storm"
        ? "storm"
        : type === "snow"
          ? "snow"
          : "cloudy";
}

function setLoading(on) {
  if (on) {
    el.loading.classList.remove("hidden");
    el.error.classList.add("hidden");
    el.content.classList.add("hidden");
  } else {
    el.loading.classList.add("hidden");
  }
}

function showError(msg) {
  el.error.textContent = msg;
  el.error.classList.remove("hidden");
  el.content.classList.add("hidden");
  el.loading.classList.add("hidden");
}

async function j(url) {
  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (res.ok) return res.json();

      if (res.status === 429) {
        throw new Error("Open-Meteo rate limit reached. Please wait a bit and try again.");
      }

      if (res.status >= 500 && attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 600 * attempt));
        continue;
      }

      throw new Error("Weather service failed. Please try again.");
    } catch (err) {
      clearTimeout(timeout);
      if (err && typeof err.message === "string" && err.message.includes("rate limit")) {
        throw err;
      }
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 600 * attempt));
        continue;
      }
      throw new Error("Weather service failed. Please try again.");
    }
  }
}

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

function getCityDisplayLabel(city) {
  const parts = [city.name];
  if (city.district) parts.push(city.district);
  return parts.join(", ");
}

function indexCatalogRows(rows) {
  cityById = new Map();
  cityByName = new Map();
  cityByLabel = new Map();

  rows.forEach((city) => {
    cityById.set(city.geonameId, city);

    const nName = normalize(city.name);
    const nDisplayLabel = normalize(getCityDisplayLabel(city));
    const nFullLabel = normalize(city.label);

    if (!cityByName.has(nName)) cityByName.set(nName, []);
    cityByName.get(nName).push(city);

    if (!cityByLabel.has(nDisplayLabel)) cityByLabel.set(nDisplayLabel, []);
    cityByLabel.get(nDisplayLabel).push(city);

    if (!cityByLabel.has(nFullLabel)) cityByLabel.set(nFullLabel, []);
    cityByLabel.get(nFullLabel).push(city);
  });

  for (const list of cityByName.values()) {
    list.sort((a, b) => (b.population || 0) - (a.population || 0));
  }

  for (const list of cityByLabel.values()) {
    list.sort((a, b) => (b.population || 0) - (a.population || 0));
  }
}

function closeCityDropdown() {
  el.cityPanel.classList.add("hidden");
}

function openCityDropdown() {
  el.cityPanel.classList.remove("hidden");
}

function filterDropdownCities(query) {
  const n = normalize(query);
  if (!n) {
    return cityCatalog.slice(0, DROPDOWN_LIMIT);
  }

  const starts = [];
  const includes = [];

  for (let i = 0; i < cityCatalog.length; i++) {
    const city = cityCatalog[i];
    const label = normalize(getCityDisplayLabel(city));
    const fullLabel = normalize(city.label);
    const name = normalize(city.name);

    if (label.startsWith(n) || fullLabel.startsWith(n) || name.startsWith(n)) {
      starts.push(city);
    } else if (label.includes(n) || fullLabel.includes(n) || name.includes(n)) {
      includes.push(city);
    }

    if ((starts.length + includes.length) >= DROPDOWN_LIMIT) break;
  }

  return [...starts, ...includes].slice(0, DROPDOWN_LIMIT);
}

function renderCityDropdownOptions(cities, showMatchMeta = true) {
  dropdownMatches = cities;
  if (showMatchMeta) {
    el.cityMeta.textContent = `${cities.length.toLocaleString()} match${cities.length === 1 ? "" : "es"} shown`;
  }

  if (!cities.length) {
    el.cityOptions.innerHTML = '<button type="button" class="city-option" disabled>No matching city found</button>';
    return;
  }

  el.cityOptions.innerHTML = cities.map((city) => `
    <button type="button" class="city-option" data-id="${city.geonameId}">
      ${getCityDisplayLabel(city)}
    </button>
  `).join("");
}

function populateCityControls(rows) {
  el.cityMeta.textContent = `Choose from ${rows.length.toLocaleString()} Nepal cities`;
  renderCityDropdownOptions(rows.slice(0, DROPDOWN_LIMIT), false);
}

async function loadCityCatalog() {
  try {
    const rows = await j(CATALOG_URL);
    if (!Array.isArray(rows) || !rows.length) throw new Error("Catalog missing.");

    cityCatalog = rows;
    indexCatalogRows(cityCatalog);
    populateCityControls(cityCatalog);
    el.allStatus.textContent = `Loaded ${cityCatalog.length.toLocaleString()} Nepal cities from GeoNames.`;
  } catch (err) {
    el.cityMeta.textContent = "City list unavailable";
    el.cityOptions.innerHTML = '<button type="button" class="city-option" disabled>City list unavailable</button>';
    el.allStatus.textContent = "Could not load city catalog. Search still works using Open-Meteo geocoding.";
  }
}

function resolveFromCatalog(query) {
  const raw = String(query || "").trim();
  const n = normalize(query);
  if (!n) return null;

  const labelMatch = cityByLabel.get(n);
  if (labelMatch && labelMatch.length) return labelMatch[0];

  const nameMatch = cityByName.get(n);
  if (nameMatch && nameMatch.length) return nameMatch[0];

  const parts = raw.split(",").map((x) => x.trim()).filter(Boolean);
  const place = normalize(parts[0] || "");
  const district = normalize(parts[1] || "");

  if (place) {
    const byPlace = cityByName.get(place);
    if (byPlace && byPlace.length) {
      if (district) {
        const districtHit = byPlace.find((city) => normalize(city.district) === district);
        if (districtHit) return districtHit;
      }
      return byPlace[0];
    }
  }

  const startsWith = cityCatalog.find((city) => {
    const label = normalize(getCityDisplayLabel(city));
    const full = normalize(city.label);
    const name = normalize(city.name);
    return label.startsWith(n) || full.startsWith(n) || name.startsWith(n);
  });
  return startsWith || null;
}

function resolveFromTopCities(query) {
  const raw = String(query || "").trim();
  if (!raw) return null;

  const cleaned = raw.split(",")[0].trim();
  const n = normalize(cleaned);
  if (!n) return null;

  const key = Object.keys(CITY_COORDS).find((name) => normalize(name) === n);
  if (!key) return null;

  return {
    name: key,
    admin1: "",
    admin2: "",
    latitude: CITY_COORDS[key].latitude,
    longitude: CITY_COORDS[key].longitude,
    geonameId: null,
    label: key
  };
}

async function geocode(city) {
  const q = city.trim();
  if (!q) throw new Error("Please enter a city name.");

  let data = await j(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=20&language=en&format=json`);
  let results = (data.results || []).filter((x) => x.country_code === "NP");

  if (!results.length) throw new Error("City not found in Nepal. Try another location.");
  return results[0];
}

async function forecast(lat, lon) {
  const p = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    timezone: "Asia/Kathmandu",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,uv_index_max",
    hourly: "temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m,weather_code",
    current: "temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m,weather_code,is_day",
    start_date: nepalDate(-1),
    end_date: nepalDate(1)
  });

  return j(`https://api.open-meteo.com/v1/forecast?${p.toString()}`);
}

function view(data) {
  const c = data.current || {};
  const d = data.daily || {};
  const h = data.hourly || {};

  const i = c.time && h.time ? h.time.indexOf(c.time) : -1;
  const get = (a) => Array.isArray(a) ? (i >= 0 ? a[i] : (a[0] ?? null)) : null;

  const tc = c.temperature_2m ?? get(h.temperature_2m);
  const hm = c.relative_humidity_2m ?? get(h.relative_humidity_2m);
  const wd = c.wind_speed_10m ?? get(h.wind_speed_10m);
  const fl = c.apparent_temperature ?? get(h.apparent_temperature);
  const code = c.weather_code ?? (d.weather_code ? d.weather_code[1] : null);
  const isDay = c.is_day === 1;

  const t = meta(code, isDay);
  const y = meta(d.weather_code ? d.weather_code[0] : null, true);
  const m = meta(d.weather_code ? d.weather_code[2] : null, true);

  return {
    today: {
      temp: tc,
      humidity: hm,
      wind: wd,
      feel: fl,
      condition: t.label,
      type: t.type,
      isDay,
      high: d.temperature_2m_max ? d.temperature_2m_max[1] : null,
      low: d.temperature_2m_min ? d.temperature_2m_min[1] : null,
      uv: d.uv_index_max ? d.uv_index_max[1] : null,
      date: d.time ? d.time[1] : nepalDate(0)
    },
    yesterday: {
      condition: y.label,
      type: y.type,
      high: d.temperature_2m_max ? d.temperature_2m_max[0] : null,
      low: d.temperature_2m_min ? d.temperature_2m_min[0] : null,
      date: d.time ? d.time[0] : nepalDate(-1)
    },
    tomorrow: {
      condition: m.label,
      type: m.type,
      high: d.temperature_2m_max ? d.temperature_2m_max[2] : null,
      low: d.temperature_2m_min ? d.temperature_2m_min[2] : null,
      date: d.time ? d.time[2] : nepalDate(1)
    }
  };
}

function day(prefix, item) {
  document.getElementById(`${prefix}Date`).textContent = prettyDate(item.date);
  document.getElementById(`${prefix}Icon`).innerHTML = icon(item.type);
  document.getElementById(`${prefix}Temp`).textContent = `H ${roundValue(item.high)}°C | L ${roundValue(item.low)}°C`;
  document.getElementById(`${prefix}Cond`).textContent = item.condition;
}

function render(loc, f) {
  document.getElementById("cityName").textContent = loc.name;
  document.getElementById("cityMeta").textContent = loc.admin2 || "Nepal";
  document.getElementById("heroTemp").textContent = `${roundValue(f.today.temp)}°C`;
  document.getElementById("heroCond").textContent = f.today.condition;
  document.getElementById("heroRange").textContent = `H: ${roundValue(f.today.high)}°C | L: ${roundValue(f.today.low)}°C`;
  document.getElementById("heroIcon").innerHTML = icon(f.today.type);

  document.getElementById("vHum").textContent = `${roundValue(f.today.humidity)}%`;
  document.getElementById("vWind").textContent = `${roundValue(f.today.wind)} km/h`;
  document.getElementById("vUv").textContent = f.today.uv == null ? "--" : f.today.uv.toFixed(1);
  document.getElementById("vFeel").textContent = `${roundValue(f.today.feel)}°C`;

  day("dY", f.yesterday);
  document.getElementById("dTDate").textContent = prettyDate(f.today.date);
  document.getElementById("dTIcon").innerHTML = icon(f.today.type);
  document.getElementById("dTTemp").textContent = `${roundValue(f.today.temp)}°C`;
  document.getElementById("dTCond").textContent = f.today.condition;
  day("dM", f.tomorrow);

  theme(f.today.type, f.today.isDay);

  el.content.classList.remove("hidden");
  el.content.classList.remove("fade");
  void el.content.offsetWidth;
  el.content.classList.add("fade");
}

async function loadCity(cityInputOrObj) {
  const id = ++reqId;
  const hadVisibleContent = !el.content.classList.contains("hidden");
  if (!hadVisibleContent) {
    setLoading(true);
  } else {
    el.error.classList.add("hidden");
  }

  try {
    let resolved = null;
    let location = null;

    if (typeof cityInputOrObj === "object" && cityInputOrObj && cityInputOrObj.latitude && cityInputOrObj.longitude) {
      resolved = cityInputOrObj;
      location = {
        name: resolved.name,
        admin1: resolved.province || resolved.admin1 || "",
        admin2: resolved.district || resolved.admin2 || "",
        latitude: resolved.latitude,
        longitude: resolved.longitude,
        geonameId: resolved.geonameId || null,
        label: resolved.label || resolved.name
      };
    } else {
      const query = String(cityInputOrObj || "").trim();
      resolved = resolveFromCatalog(query);
      const quickKnown = resolveFromTopCities(query);

      if (resolved || quickKnown) {
        const source = resolved || quickKnown;
        location = {
          name: source.name,
          admin1: source.province || source.admin1 || "",
          admin2: source.district || source.admin2 || "",
          latitude: source.latitude,
          longitude: source.longitude,
          geonameId: source.geonameId || null,
          label: source.district ? `${source.name}, ${source.district}` : (source.label || source.name)
        };
      } else {
        const geoQuery = query.split(",")[0].trim();
        const geo = await geocode(geoQuery);
        location = {
          name: geo.name,
          admin1: geo.admin1 || "",
          admin2: geo.admin2 || "",
          latitude: geo.latitude,
          longitude: geo.longitude,
          geonameId: null,
          label: geo.admin2 ? `${geo.name}, ${geo.admin2}` : geo.name
        };
      }
    }

    const raw = await forecast(location.latitude, location.longitude);
    if (id !== reqId) return;

    setLoading(false);
    el.error.classList.add("hidden");
    render(location, view(raw));

    el.citySearch.value = location.label || location.name;
    replaceSearchOnNextType = true;
    if (location.geonameId && cityById.has(location.geonameId)) {
      el.citySearch.dataset.cityId = String(location.geonameId);
      localStorage.setItem(STORE_CITY_ID_KEY, String(location.geonameId));
    } else {
      delete el.citySearch.dataset.cityId;
      localStorage.removeItem(STORE_CITY_ID_KEY);
    }

    localStorage.setItem(STORE_KEY, location.label || location.name);
    closeCityDropdown();
  } catch (e) {
    if (id !== reqId) return;
    if (hadVisibleContent) {
      el.error.textContent = e.message || "Unable to load weather right now.";
      el.error.classList.remove("hidden");
      el.loading.classList.add("hidden");
      return;
    }
    showError(e.message || "Unable to load weather right now.");
  }
}

async function refreshBar() {
  try {
    const batch = BAR_CITIES.map((city) => ({ city, ...CITY_COORDS[city] }));
    const p = new URLSearchParams({
      latitude: batch.map((x) => x.latitude).join(","),
      longitude: batch.map((x) => x.longitude).join(","),
      timezone: "Asia/Kathmandu",
      current: "temperature_2m"
    });

    const data = await j(`https://api.open-meteo.com/v1/forecast?${p.toString()}`);
    const list = Array.isArray(data) ? data : [data];
    const ok = batch
      .map((item, idx) => ({ city: item.city, temp: list[idx]?.current?.temperature_2m }))
      .filter((x) => typeof x.temp === "number");

    if (!ok.length) {
      if (lastTopBarHtml) {
        el.ticker.innerHTML = `${lastTopBarHtml}<span class="sep">|</span><span>Using last update</span>`;
      } else {
        el.ticker.innerHTML = "<span>Unable to load Nepal temperature bar right now.</span>";
      }
      return;
    }

    const hi = ok.reduce((a, b) => (b.temp > a.temp ? b : a), ok[0]);
    const lo = ok.reduce((a, b) => (b.temp < a.temp ? b : a), ok[0]);
    const tm = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: "Asia/Kathmandu"
    }).format(new Date());

    lastTopBarHtml = `<span class="t-hi">🔴 Highest: ${hi.city} ${roundValue(hi.temp)}°C</span><span class="sep">|</span><span class="t-lo">🔵 Lowest: ${lo.city} ${roundValue(lo.temp)}°C</span><span class="sep">|</span><span>Updated: ${tm} NPT</span>`;
    el.ticker.innerHTML = lastTopBarHtml;
  } catch {
    if (lastTopBarHtml) {
      el.ticker.innerHTML = `${lastTopBarHtml}<span class="sep">|</span><span>Using last update</span>`;
    } else {
      el.ticker.innerHTML = "<span>Unable to load Nepal temperature bar right now.</span>";
    }
  }
}

async function fetchLiveBatch(batch) {
  const p = new URLSearchParams({
    latitude: batch.map((c) => c.latitude).join(","),
    longitude: batch.map((c) => c.longitude).join(","),
    timezone: "Asia/Kathmandu",
    current: "temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code,is_day"
  });

  const data = await j(`https://api.open-meteo.com/v1/forecast?${p.toString()}`);
  const list = Array.isArray(data) ? data : [data];

  return batch.map((city, idx) => {
    const current = (list[idx] && list[idx].current) ? list[idx].current : null;
    const weatherCode = current ? current.weather_code : null;
    const isDay = current ? current.is_day === 1 : true;
    const m = meta(weatherCode, isDay);

    return {
      geonameId: city.geonameId,
      name: city.name,
      province: city.province || "-",
      label: city.label,
      temperature: current ? current.temperature_2m : null,
      humidity: current ? current.relative_humidity_2m : null,
      wind: current ? current.wind_speed_10m : null,
      condition: m.label
    };
  });
}

function renderLiveTable() {
  if (!filteredLiveRows.length) {
    el.allCitiesBody.innerHTML = "<tr><td colspan=\"6\">No city matches the current filter.</td></tr>";
    el.pageInfo.textContent = "Page 0 / 0";
    el.prevPage.disabled = true;
    el.nextPage.disabled = true;
    return;
  }

  const totalPages = Math.ceil(filteredLiveRows.length / PAGE_SIZE);
  currentPage = Math.min(Math.max(1, currentPage), totalPages);

  const start = (currentPage - 1) * PAGE_SIZE;
  const pageRows = filteredLiveRows.slice(start, start + PAGE_SIZE);

  el.allCitiesBody.innerHTML = pageRows.map((row) => `
    <tr>
      <td>${row.name}</td>
      <td>${row.province}</td>
      <td>${roundValue(row.temperature)}°C</td>
      <td>${row.condition}</td>
      <td>${roundValue(row.humidity)}%</td>
      <td>${roundValue(row.wind)} km/h</td>
    </tr>
  `).join("");

  el.pageInfo.textContent = `Page ${currentPage} / ${totalPages}`;
  el.prevPage.disabled = currentPage <= 1;
  el.nextPage.disabled = currentPage >= totalPages;
}

function applyLiveFilter() {
  const q = normalize(el.allFilter.value);

  if (!q) {
    filteredLiveRows = [...liveCityRows];
  } else {
    filteredLiveRows = liveCityRows.filter((row) => {
      return normalize(row.name).includes(q) || normalize(row.province).includes(q) || normalize(row.label).includes(q);
    });
  }

  currentPage = 1;
  renderLiveTable();
}

async function loadAllCitiesLiveData() {
  if (isLoadingAllCities) return;
  if (!cityCatalog.length) {
    el.allStatus.textContent = "City catalog is not available yet.";
    return;
  }

  isLoadingAllCities = true;
  el.loadAllBtn.disabled = true;
  el.allFilter.disabled = true;
  const targetCities = cityCatalog.slice(0, MAX_CITIES_PER_REFRESH);
  el.allStatus.textContent = `Fetching actual live weather for ${targetCities.length.toLocaleString()} cities (limited to avoid API rate limits)...`;

  try {
    const chunks = chunkArray(targetCities, 40);
    const rowsByChunk = new Array(chunks.length);
    let nextChunk = 0;
    let processed = 0;
    const concurrency = Math.min(1, chunks.length);

    const worker = async () => {
      while (true) {
        const currentIndex = nextChunk;
        nextChunk += 1;
        if (currentIndex >= chunks.length) return;

        const batch = chunks[currentIndex];
        try {
          const part = await fetchLiveBatch(batch);
          rowsByChunk[currentIndex] = part;
        } catch {
          rowsByChunk[currentIndex] = batch.map((city) => ({
            geonameId: city.geonameId,
            name: city.name,
            province: city.province || "-",
            label: city.label,
            temperature: null,
            humidity: null,
            wind: null,
            condition: "Unavailable"
          }));
        }

        processed += batch.length;
        el.allStatus.textContent = `Fetching actual live weather: ${Math.min(processed, targetCities.length).toLocaleString()} / ${targetCities.length.toLocaleString()} cities`;
      }
    };

    await Promise.all(Array.from({ length: concurrency }, worker));
    const rows = rowsByChunk.flat();

    rows.sort((a, b) => a.name.localeCompare(b.name));
    liveCityRows = rows;
    filteredLiveRows = [...rows];

    const now = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: "Asia/Kathmandu"
    }).format(new Date());

    el.allStatus.textContent = `Loaded live data for ${rows.length.toLocaleString()} cities at ${now} NPT (rate-limit safe mode).`;
    el.allFilter.disabled = false;
    el.loadAllBtn.disabled = false;
    renderLiveTable();
  } catch (err) {
    el.allStatus.textContent = "Failed to load all-city live data. Please retry.";
    el.loadAllBtn.disabled = false;
    el.allFilter.disabled = liveCityRows.length === 0;
  } finally {
    isLoadingAllCities = false;
  }
}

function wireEvents() {
  el.citySearch.addEventListener("focus", () => {
    el.citySearch.select();
    replaceSearchOnNextType = true;
    renderCityDropdownOptions(filterDropdownCities(el.citySearch.value));
    openCityDropdown();
  });

  el.citySearch.addEventListener("click", () => {
    el.citySearch.select();
    replaceSearchOnNextType = true;
  });

  el.citySearch.addEventListener("input", () => {
    replaceSearchOnNextType = false;
    renderCityDropdownOptions(filterDropdownCities(el.citySearch.value));
    openCityDropdown();
  });

  el.citySearch.addEventListener("keydown", (e) => {
    const isTypingKey = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
    if (replaceSearchOnNextType && isTypingKey) {
      el.citySearch.value = "";
      replaceSearchOnNextType = false;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      if (dropdownMatches.length) {
        loadCity(dropdownMatches[0]);
      } else {
        loadCity(el.citySearch.value.trim());
      }
      return;
    }

    if (e.key === "Escape") {
      closeCityDropdown();
    }
  });

  el.cityToggle.addEventListener("click", () => {
    if (el.cityPanel.classList.contains("hidden")) {
      renderCityDropdownOptions(filterDropdownCities(el.citySearch.value));
      openCityDropdown();
    } else {
      closeCityDropdown();
    }
  });

  el.cityOptions.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-id]");
    if (!btn) return;
    const id = Number(btn.dataset.id);
    if (!id || !cityById.has(id)) return;
    loadCity(cityById.get(id));
  });

  document.addEventListener("click", (e) => {
    if (!el.cityDropdown.contains(e.target)) {
      closeCityDropdown();
    }
  });

  el.loadAllBtn.addEventListener("click", loadAllCitiesLiveData);
  el.allFilter.addEventListener("input", applyLiveFilter);

  el.prevPage.addEventListener("click", () => {
    currentPage -= 1;
    renderLiveTable();
  });

  el.nextPage.addEventListener("click", () => {
    currentPage += 1;
    renderLiveTable();
  });
}

async function init() {
  wireEvents();
  const catalogPromise = loadCityCatalog();
  const savedId = Number(localStorage.getItem(STORE_CITY_ID_KEY) || "");
  const savedLabel = localStorage.getItem(STORE_KEY) || DEFAULT_CITY;
  const initialQuery = savedLabel || DEFAULT_CITY;

  el.citySearch.value = initialQuery;
  await loadCity(initialQuery);

  await catalogPromise;

  if (savedId && cityById.has(savedId)) {
    const city = cityById.get(savedId);
    el.citySearch.value = city.label || city.name;
    el.citySearch.dataset.cityId = String(savedId);
  }

  refreshBar();
  setInterval(refreshBar, BAR_MS);

  // Keep all-city loading manual to avoid exhausting Open-Meteo hourly request limits.
}

window.addEventListener("DOMContentLoaded", init);
