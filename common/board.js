import {
	ButtonBuilder,
	ButtonStyle,
	ChannelType,
	ComponentType,
	EmbedBuilder,
	Message,
} from "discord.js";
import { guild } from "../client.js";
import { extractMessageExtremities, getBaseChannel, messageToText } from "../lib/discord.js";
import { MessageActionRowBuilder } from "../types/ActionRowBuilder.js";
import CONSTANTS from "./CONSTANTS.js";
import Database from "./database.js";

import { censor } from "./moderation/automod.js";

export const BOARD_EMOJI = "🥔";
/** @param {import("discord.js").TextBasedChannel} [channel] */
export function reactionCount(channel) {
	const COUNTS = { scradd: 2, devs: 6, modsPlus: 5, mods: 4, admins: 3, default: 8 };
	if (process.env.NODE_ENV !== "production") return COUNTS.scradd;
	const baseChannel = getBaseChannel(channel);
	if (!baseChannel) return COUNTS.default;
	if (baseChannel.isDMBased()) return COUNTS.mods;
	if (baseChannel.parent?.id === "866028754962612294") return COUNTS.modsPlus;

	return (
		/** @type {{ [key: string]: number }} */ ({
			["806895693162872892"]: COUNTS.mods,
			["816329956074061867"]: COUNTS.admins,
			["939350305311715358"]: COUNTS.mods,
			["869662117651955802"]: COUNTS.devs,
			["853256939089559583"]: COUNTS.modsPlus,
			["894314668317880321"]: COUNTS.modsPlus,
		})[baseChannel.id] || 8
	);
}

if (!CONSTANTS.channels.board) throw new ReferenceError("Could not find board channel");

const database = new Database("board");
await database.init();
export { database as boardDatabase };

/**
 * @param {import("../types/databases").default["board"] | import("discord.js").Message} info
 * @param {{ pre?: ButtonBuilder[]; post?: ButtonBuilder[] }} [extraButtons]
 *
 * @returns {Promise<import("discord.js").WebhookEditMessageOptions | undefined>}
 */
export async function generateMessage(info, extraButtons = {}) {
	const count =
		info instanceof Message ? info.reactions.resolve(BOARD_EMOJI)?.count || 0 : info.reactions;
	/**
	 * @param {import("discord.js").Message} message
	 *
	 * @returns {Promise<import("discord.js").WebhookEditMessageOptions | undefined>}
	 */
	async function messageToBoardData(message) {
		const { files, embeds } = await extractMessageExtremities(message, false);

		const description = await messageToText(message);

		const censored = censor(description);
		const censoredName = censor(message.author.username);

		const boardEmbed = new EmbedBuilder()
			.setColor(message.member?.displayColor ?? 0)
			.setDescription(censored ? censored.censored : description || null)
			.setAuthor({
				iconURL: (message.member ?? message.author).displayAvatarURL(),
				name:
					message.member?.displayName ??
					(censoredName ? censoredName.censored : message.author.username),
			})
			.setTimestamp(message.createdAt);

		const button = new ButtonBuilder()
			.setLabel("View Context")
			.setStyle(ButtonStyle.Link)
			.setURL(message.url);

		while (embeds.length > 9) embeds.pop(); // 9 and not 10 because we still need to add ours

		return {
			allowedMentions: { users: [] },
			components: [
				new MessageActionRowBuilder().addComponents(
					...(extraButtons.pre || []),
					button,
					...(extraButtons.post || []),
				),
			],

			content: `**${BOARD_EMOJI} ${count}** | ${message.channel.toString()}${
				message.channel.isThread()
					? ` (${
							[CONSTANTS.channels.modmail?.id, CONSTANTS.channels.admin?.id].includes(
								message.channel.parent?.id,
							)
								? "#deleted-channel"
								: message.channel.parent?.toString() ?? ""
					  })`
					: ""
			} | ${message.author.toString()}`,
			embeds: [boardEmbed, ...embeds],
			files,
		};
	}

	if (info instanceof Message) return messageToBoardData(info);
	if (!CONSTANTS.channels.board) throw new ReferenceError("Could not find board channel");
	const onBoard =
		info.onBoard &&
		(await CONSTANTS.channels.board.messages.fetch(info.onBoard).catch(() => {}));
	if (onBoard) {
		const linkButton = onBoard.components?.[0]?.components?.[0];
		const buttons =
			linkButton?.type === ComponentType.Button
				? [
						...(extraButtons.pre || []),
						ButtonBuilder.from(linkButton),
						...(extraButtons.post || []),
				  ]
				: [...(extraButtons.pre || []), ...(extraButtons.post || [])];

		return {
			allowedMentions: { users: [] },

			components: buttons.length
				? [new MessageActionRowBuilder().setComponents(buttons)]
				: [],

			content: onBoard.content,
			embeds: onBoard.embeds.map((oldEmbed) => EmbedBuilder.from(oldEmbed)),
			files: onBoard.attachments.map((attachment) => attachment),
		};
	}
	const channel = await guild.channels.fetch(info.channel).catch(() => {});
	if (!channel?.isTextBased()) return;
	const message = await channel.messages.fetch(info.source).catch(() => {});
	if (!message) return;
	return messageToBoardData(message);
}

/**
 * Update the count on a message on #potatoboard.
 *
 * @param {import("discord.js").Message} message
 */
export async function updateBoard(message) {
	const count = message.reactions.resolve(BOARD_EMOJI)?.count || 0;
	const minReactions = reactionCount(message.channel);
	const info = database.data.find(({ source }) => source === message.id);
	if (!CONSTANTS.channels.board) throw new ReferenceError("Could not find board channel");
	const boardMessage =
		info?.onBoard &&
		(await CONSTANTS.channels.board?.messages.fetch(info.onBoard).catch(() => {}));
	if (boardMessage) {
		if (count < Math.max(Math.round(minReactions - minReactions / 6), 1)) {
			await boardMessage.delete();
		} else {
			await boardMessage.edit({
				allowedMentions: process.env.NODE_ENV === "production" ? undefined : { users: [] },
				content: boardMessage.content.replace(/\d+/, `${count}`),
			});
		}
	} else if (count >= minReactions) {
		if (!CONSTANTS.channels.board) throw new ReferenceError("Could not find board channel");

		const boardMessage = await CONSTANTS.channels.board.send({
			allowedMentions: process.env.NODE_ENV === "production" ? undefined : { users: [] },
			...(await generateMessage(message)),
		});
		if (CONSTANTS.channels.board.type === ChannelType.GuildNews) await boardMessage.crosspost();

		if (info) {
			database.data = database.data.map((item) =>
				item.source === message.id
					? { ...item, reactions: count, onBoard: boardMessage.id }
					: item,
			);
		}
		const top = database.data
			.sort((a, b) => b.reactions - a.reactions)
			.map(({ onBoard }) => onBoard);
		top.splice(10);
		top.map(async (onBoard) => {
			const toPin =
				onBoard && (await CONSTANTS.channels.board?.messages.fetch(onBoard).catch(() => {}));
			toPin && toPin.pin();
		});
		CONSTANTS.channels.board.messages.fetchPinned().then(async (pins) => {
			pins.size > 10 &&
				(await Promise.all(pins.map((pin) => !top.includes(pin.id) && pin.unpin())));
		});
		if (info) return;
	}
	database.data = info
		? count
			? database.data.map((item) =>
					item.source === message.id ? { ...item, reactions: count } : item,
			  )
			: database.data.filter((item) => item.source !== message.id)
		: count
		? [
				...database.data,
				{
					reactions: count,
					user: message.author.id,
					channel: message.channel.id,
					source: message.id,
				},
		  ]
		: database.data;
}
