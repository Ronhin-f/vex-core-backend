const inviteUser = require('../tools/core/inviteUser');
const resendInvite = require('../tools/core/resendInvite');
const resetPassword = require('../tools/core/resetPassword');
const markTaskDone = require('../tools/crm/markTaskDone');
const changeLeadStatus = require('../tools/crm/changeLeadStatus');
const createProduct = require('../tools/stock/createProduct');
const registerMovement = require('../tools/stock/registerMovement');

const tools = [
  inviteUser,
  resendInvite,
  resetPassword,
  markTaskDone,
  changeLeadStatus,
  createProduct,
  registerMovement,
];

const toolMap = new Map(tools.map((t) => [t.name, t]));

function getTool(name) {
  return toolMap.get(name);
}

function listTools() {
  return tools.slice();
}

module.exports = { getTool, listTools };
