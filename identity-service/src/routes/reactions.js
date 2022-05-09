const { handleResponse, errorResponseBadRequest, errorResponseServerError, successResponse } = require('../apiHelpers')
const authMiddleware = require('../authMiddleware')
const models = require('../models')
const { logger } = require('../logging')

const MAX_REACTIONS_PER_FETCH = 100

const handleReaction = async ({ senderWallet, reactionType, reactedTo, libs, reaction }) => {
  const { solanaWeb3Manager } = libs
  const currentSlot = await solanaWeb3Manager.getSlot()

  const now = Date.now()
  await models.Reactions.create({
    slot: currentSlot,
    reaction,
    senderWallet,
    reactionType,
    reactedTo,
    createdAt: now,
    updatedAt: now
  })
}

const getReactions = async ({ startIndex, limit }) => {
  const reactions = await models.Reactions.findAll({
    where: {
      id: { [models.Sequelize.Op.gte]: startIndex }
    },
    order: [[models.Sequelize.col('id'), 'ASC']],
    limit
  })
  return reactions
}

module.exports = function (app) {
  /**
   * POST a new reaction, represented by a numeric ID (reaction) and reactedTo (entity being reacted upon)
   */
  app.post('/reactions', authMiddleware, handleResponse(async (req, res, next) => {
    // Validation
    const senderWallet = req.user.walletAddress
    const { reactedTo, reaction } = req.body

    if (!(senderWallet && reactedTo && reaction)) return errorResponseBadRequest(`Missing argument: ${JSON.stringify({ senderWallet, reactedTo, reaction })}`)

    const parsedReaction = parseInt(reaction)
    if (!parsedReaction) return errorResponseBadRequest('Invalid reaction type')

    const libs = req.app.get('audiusLibs')

    try {
      logger.info(`Creating reaction ${reaction} for reactedTo: ${reactedTo}`)
      await handleReaction({ senderWallet, reactedTo, reaction: parsedReaction, reactionType: 'tip', libs })
      return successResponse()
    } catch (e) {
      logger.error(`Caught error trying to create reaction ${reaction} for id: ${reactedTo}: ${e}`)
      return errorResponseServerError('Something went wrong')
    }
  }))

  /**
   * Get all reactions with ID >= startIndex
   */
  app.get('/reactions', handleResponse(async (req, res, next) => {
    let { startIndex, limit } = req.query
    startIndex = startIndex || 0
    limit = Math.min(MAX_REACTIONS_PER_FETCH, limit || MAX_REACTIONS_PER_FETCH)

    try {
      const reactions = await getReactions({ startIndex, limit })
      return successResponse({
        reactions
      })
    } catch (e) {
      logger.error(`Caught error trying to get reactions: ${e}`)
      return errorResponseServerError('Something went wrong')
    }
  }))
}
