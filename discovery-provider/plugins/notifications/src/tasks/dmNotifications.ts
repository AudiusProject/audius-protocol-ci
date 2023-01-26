import { Knex } from 'knex'
import type { RedisClientType } from 'redis'
import { config } from './../config'
import { logger } from './../logger'
import { MessageNotification } from './../processNotifications/mappers/message'
import { MessageReactionNotification } from './../processNotifications/mappers/messageReaction'
import type { DMNotification, DMReactionNotification } from './../types/notifications'
import { getRedisConnection } from './../utils/redisConnection'

// Sort notifications in ascending order according to timestamp
function notificationTimestampComparator(n1: MessageNotification | MessageReactionNotification, n2: MessageNotification | MessageReactionNotification): number {
  if (n1.notification.timestamp < n2.notification.timestamp) {
    return -1
  }
  if (n1.notification.timestamp > n2.notification.timestamp) {
    return 1
  }
  return 0
}

async function getCursors(redis: RedisClientType): Promise<{ maxTimestamp: Date; minMessageTimestamp: Date; minReactionTimestamp: Date }> {
  const maxCursor = new Date(Date.now() - config.dmNotificationDelay)

  // Get min cursors from redis (timestamps of the last indexed notifications)
  let minMessageCursor = maxCursor
  let minReactionCursor = maxCursor
  const cachedMessageTimestamp = await redis.get(config.lastIndexedMessageRedisKey)
  if (cachedMessageTimestamp) {
    minMessageCursor = new Date(Date.parse(cachedMessageTimestamp))
  }
  const cachedReactionTimestamp = await redis.get(config.lastIndexedReactionRedisKey)
  if (cachedReactionTimestamp) {
    minReactionCursor = new Date(Date.parse(cachedReactionTimestamp))
  }

  return {
    maxTimestamp: maxCursor,
    minMessageTimestamp: minMessageCursor,
    minReactionTimestamp: minReactionCursor,
  }
}

async function getUnreadMessages(discoveryDB: Knex, minTimestamp: Date, maxTimestamp: Date): Promise<DMNotification[]> {
  return await discoveryDB
    .select('chat_message.user_id as sender_user_id', 'chat_member.user_id as receiver_user_id', 'chat_message.ciphertext as message', 'chat_message.created_at as timestamp')
    .from('chat_message')
    .innerJoin('chat_member', 'chat_message.chat_id', 'chat_member.chat_id')
    .whereRaw('chat_message.created_at > greatest(chat_member.last_active_at, ?::timestamp)', [minTimestamp.toISOString()])
    .andWhere('chat_message.created_at', '<=', maxTimestamp.toISOString())
    .andWhereRaw('chat_message.user_id != chat_member.user_id')
}

async function getUnreadReactions(discoveryDB: Knex, minTimestamp: Date, maxTimestamp: Date): Promise<DMReactionNotification[]> {
  return await discoveryDB
    .select('chat_message_reactions.user_id as sender_user_id', 'chat_message.user_id as receiver_user_id', 'chat_message_reactions.reaction as reaction', 'chat_message.ciphertext as message', 'chat_message_reactions.updated_at as timestamp')
    .from('chat_message_reactions')
    .innerJoin('chat_message', 'chat_message.message_id', 'chat_message_reactions.message_id')
    .joinRaw('join chat_member on chat_member.chat_id = chat_message.chat_id and chat_member.user_id = chat_message.user_id')
    .whereRaw('chat_message_reactions.updated_at > greatest(chat_member.last_active_at, ?)', [minTimestamp.toISOString()])
    .andWhere('chat_message_reactions.updated_at', '<=', maxTimestamp.toISOString())
    .andWhereRaw('chat_message_reactions.user_id != chat_member.user_id')
}

function setLastIndexedTimestamp(redis: RedisClientType, redisKey: string, maxTimestamp: Date, notifications: MessageNotification[] | MessageReactionNotification[]) {
  if (notifications.length > 0) {
    notifications.sort(notificationTimestampComparator)
    const lastIndexedTimestamp = notifications[notifications.length - 1].notification.timestamp.toISOString()
    redis.set(redisKey, lastIndexedTimestamp)
    console.log(`setting last indexed timestamp to ${lastIndexedTimestamp} for key ${redisKey}`)
  } else {
    redis.set(redisKey, maxTimestamp.toISOString())
  }
}

export async function sendDMNotifications(discoveryDB: Knex, identityDB: Knex) {
  // Query DN for unread messages and reactions between min and max cursors
  const redis = await getRedisConnection()
  const cursors = await getCursors(redis)
  const unreadMessages = await getUnreadMessages(discoveryDB, cursors.minMessageTimestamp, cursors.maxTimestamp)
  const unreadReactions = await getUnreadReactions(discoveryDB, cursors.minReactionTimestamp, cursors.maxTimestamp)

  // Convert to notifications
  const messageNotifications = unreadMessages.map(message => new MessageNotification(discoveryDB, identityDB, message))
  const reactionNotifications = unreadReactions.map(reaction => new MessageReactionNotification(discoveryDB, identityDB, reaction))
  const notifications: Array<MessageNotification | MessageReactionNotification> = messageNotifications.concat(reactionNotifications)

  // Sort notifications by timestamp (asc)
  notifications.sort(notificationTimestampComparator)

  // Send push notifications
  for (const notification of notifications) {
    await notification.pushNotification()
  }

  // Set last indexed timestamps in redis
  setLastIndexedTimestamp(redis, config.lastIndexedMessageRedisKey, cursors.maxTimestamp, messageNotifications)
  setLastIndexedTimestamp(redis, config.lastIndexedReactionRedisKey, cursors.maxTimestamp, reactionNotifications)

  if (notifications.length > 0) {
    logger.info('processed new DM notifications')
  }
}
