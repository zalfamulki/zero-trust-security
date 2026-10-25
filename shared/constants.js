module.exports = {
  JWT_ISSUER: 'sistem-nilai-gateway',
  ACCESS_TOKEN_TTL: '10m', // access token user: 10 menit
  SERVICE_TOKEN_TTL: '5m', // token service: 5 menit
  REFRESH_TOKEN_TTL_MS: 24 * 60 * 60 * 1000, // refresh token: 1 hari
};
