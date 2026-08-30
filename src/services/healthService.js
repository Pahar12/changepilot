function getHealthStatus() {
  return {
    status: 'ok',
    message: 'ChangePilot API is running'
  };
}

module.exports = {
  getHealthStatus
};
