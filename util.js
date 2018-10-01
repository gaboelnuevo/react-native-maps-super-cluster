'use-strict'

/**
 * Compute bounding box for the given region
 * @param {Object} region - Google Maps/MapKit region
 * @returns {Object} - Region's bounding box as WSEN array
 */
export const regionToBoundingBox = (region) => {
  let lngD
  if (region.longitudeDelta < 0)
    lngD = region.longitudeDelta + 360
  else
    lngD = region.longitudeDelta

  return ([
    region.longitude - lngD, // westLng - min lng
    region.latitude - region.latitudeDelta, // southLat - min lat
    region.longitude + lngD, // eastLng - max lng
    region.latitude + region.latitudeDelta // northLat - max lat
  ])
}

/**
 * Calculate region from the given bounding box.
 * Bounding box must be represented as WSEN:
 * {
 *   ws: { longitude: minLon, latitude: minLat }
 *   en: { longitude: maxLon, latitude: maxLat }
 * }
 * @param {Object} bbox - Bounding box
 * @returns {Object} - Google Maps/MapKit compliant region
 */
export const boundingBoxToRegion = (bbox) => {
  const minLon = bbox.ws.longitude * Math.PI / 180,
        maxLon = bbox.en.longitude * Math.PI / 180

  const minLat = bbox.ws.latitude * Math.PI / 180,
        maxLat = bbox.en.latitude * Math.PI / 180

  const dLon = maxLon - minLon,
        dLat = maxLat - minLat

  const x = Math.cos(maxLat) * Math.cos(dLon),
        y = Math.cos(maxLat) * Math.sin(dLon)

  const latRad = Math.atan2(Math.sin(minLat) + Math.sin(maxLat), Math.sqrt((Math.cos(minLat) + x) * (Math.cos(minLat) + x) + y * y )),
        lonRad = minLon + Math.atan2(y, Math.cos(minLat) + x)

  const latitude = latRad * 180 / Math.PI,
        longitude = lonRad * 180 / Math.PI

  return {
    latitude,
    longitude,
    latitudeDelta: dLat * 180 / Math.PI,
    longitudeDelta: dLon * 180 / Math.PI
  }
}

/**
 * Compute a RFC-compliant GeoJSON Feature object
 * from the given JS object
 * RFC7946: https://tools.ietf.org/html/rfc7946#section-3.2
 * @param {Object} item - JS object containing marker data
 * @returns {Object} - GeoJSON Feature object
 */
export const itemToGeoJSONFeature = (item) => ({
  type: 'Feature',
  geometry: {
    type: 'Point',
    coordinates: [item.location.longitude, item.location.latitude]
  },
  properties: { point_count: 0, item } // eslint-disable-line camelcase
})

/**
 * Calculates the haversine distance between point A, and B.
 * @param {number[]} latlngA [lat, lng] point A
 * @param {number[]} latlngB [lat, lng] point B
 * @param {boolean} isMiles If we are using miles, else km.
 */
export const haversineDistance = (latlngA, latlngB, isMiles) => {
  const toRad = x => (x * Math.PI) / 180;
  const R = 6371; // km

  const dLat = toRad(latlngB[1] - latlngA[1]);
  const dLatSin = Math.sin(dLat / 2);
  const dLon = toRad(latlngB[0] - latlngA[0]);
  const dLonSin = Math.sin(dLon / 2);

  const a = (dLatSin * dLatSin) +
            (Math.cos(toRad(latlngA[1])) * Math.cos(toRad(latlngB[1])) * dLonSin * dLonSin);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  let distance = R * c;

  if (isMiles) distance /= 1.60934;

  return distance;
}

/**
 * Calculate the center/average of multiple GeoLocation coordinates
 * Expects an array of objects with .latitude and .longitude properties
 *
 * @url http://stackoverflow.com/a/14231286/538646
 */
export const averageGeolocation = (coords) => {
  if (coords.length === 1) {
    return coords[0];
  }

  let x = 0.0;
  let y = 0.0;
  let z = 0.0;

  for (let coord of coords) {
    let latitude = coord.latitude * Math.PI / 180;
    let longitude = coord.longitude * Math.PI / 180;

    x += Math.cos(latitude) * Math.cos(longitude);
    y += Math.cos(latitude) * Math.sin(longitude);
    z += Math.sin(latitude);
  }

  let total = coords.length;

  x = x / total;
  y = y / total;
  z = z / total;

  let centralLongitude = Math.atan2(y, x);
  let centralSquareRoot = Math.sqrt(x * x + y * y);
  let centralLatitude = Math.atan2(z, centralSquareRoot);

  return {
    latitude: centralLatitude * 180 / Math.PI,
    longitude: centralLongitude * 180 / Math.PI
  };
}
