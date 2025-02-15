import {
	type APIButtonComponent,
	type BaseMessageOptions,
	ButtonStyle,
	ComponentType,
	Message,
	MessageType,
	type Snowflake,
	type TextBasedChannel,
	BaseChannel,
	ChannelType,
} from "discord.js";
import config from "../../common/config.js";
import Database from "../../common/database.js";
import { extractMessageExtremities, getBaseChannel, messageToText } from "../../util/discord.js";
import tryCensor, { censor } from "../automod/language.js";

export const BOARD_EMOJI = "🥔",
	REACTIONS_NAME = "Potatoes";

export const boardDatabase = new Database<{
	/** The number of reactions this message has. */
	reactions: number;
	/** The ID of the user who posted this. */
	user: Snowflake;
	/** The ID of the channel this message is in. */
	channel: Snowflake;
	/** The ID of the message on the board. */
	onBoard: Snowflake | 0;
	/** The ID of the original message. */
	source: Snowflake;
}>("board");
await boardDatabase.init();

const COUNTS = {
	scradd: 2,
	admins: 2,
	mods: 3,
	private: 4,
	misc: 5,
	default: 6,
	memes: 8,
	info: 12,
} as const;
/**
 * Determines the board reaction count for a channel.
 *
 * @param channel - The channel to determine reaction count for.
 *
 * @returns The reaction count.
 */
export function boardReactionCount(channel?: TextBasedChannel, time?: Date): number;
export function boardReactionCount(channel: { id: Snowflake }, time?: Date): number | undefined;
export function boardReactionCount(
	channel?: TextBasedChannel | { id: Snowflake },
	time = new Date(),
) {
	if (process.env.NODE_ENV !== "production") return shift(COUNTS.scradd);
	if (!channel) return shift(COUNTS.default);

	if (channel.id === config.channels.updates?.id) return shift(COUNTS.info);
	if (!(channel instanceof BaseChannel)) {
		const count = baseReactionCount(channel.id);
		return count && shift(count);
	}

	if (!channel.isTextBased()) return shift(COUNTS.default);
	const baseChannel = getBaseChannel(channel);
	if (!baseChannel || baseChannel.isDMBased()) return shift(COUNTS.default);
	if (baseChannel.isVoiceBased()) return shift(COUNTS.misc);

	const count =
		baseReactionCount(baseChannel.id) ??
		{
			[config.channels.info?.id || ""]: COUNTS.info,
			[config.channels.modlogs?.parent?.id || ""]: COUNTS.private,
			"866028754962612294": COUNTS.misc, // #The Cache
		}[baseChannel.parent?.id || ""] ??
		COUNTS.default;
	return shift(count);

	function shift(count: number) {
		const privateThread =
			channel instanceof BaseChannel && channel.type === ChannelType.PrivateThread
				? 2 / 3
				: 1;
		/** 365 = number of days for required potato count to double. */
		const timeShift = (Date.now() - +time) / 86_400_000 / 365 + 1;
		return Math.max(2, Math.round(count * privateThread * timeShift));
	}
}
function baseReactionCount(id: Snowflake) {
	if (process.env.NODE_ENV !== "production") return COUNTS.scradd;

	return {
		[config.channels.tickets?.id || ""]: COUNTS.default,
		[config.channels.admin?.id || ""]: COUNTS.admins,
		"853256939089559583": COUNTS.private, // #ba-doosters
		[config.channels.devs?.id || ""]: COUNTS.private,
		"811065897057255424": COUNTS.memes, // #memes
		"806609527281549312": COUNTS.memes, // #collabs-and-ideas
		"806656240129671188": COUNTS.memes, // #showcase
		[config.channels.advertise?.id || ""]: COUNTS.memes,
		"939350305311715358": COUNTS.mods, // #modmail
		"894314668317880321": COUNTS.mods, // #evil-secret-youtube-plans
	}[id];
}

/**
 * Generate an embed and button to represent a board message with.
 *
 * @param info - Info to generate a message from.
 * @param extraButtons - Extra custom buttons to show.
 *
 * @returns The representation of the message.
 */
export async function generateBoardMessage(
	info: typeof boardDatabase.data[number] | Message,
	extraButtons: { pre?: APIButtonComponent[]; post?: APIButtonComponent[] } = {},
): Promise<BaseMessageOptions | undefined> {
	const count =
		info instanceof Message ? info.reactions.resolve(BOARD_EMOJI)?.count || 0 : info.reactions;

	/**
	 * Convert a message to an embed and button representation.
	 *
	 * @param message - The message to convert.
	 *
	 * @returns The converted message.
	 */
	async function messageToBoardData(message: Message): Promise<BaseMessageOptions> {
		const { files, embeds } = extractMessageExtremities(message, tryCensor);
		while (embeds.length > 9) embeds.pop(); // 9 and not 10 because we still need to add ours

		return {
			allowedMentions: { users: [] },

			components: [
				{
					type: ComponentType.ActionRow,

					components: [
						...(extraButtons.pre || []),
						{
							label: "Message",
							style: ButtonStyle.Link,
							type: ComponentType.Button,
							url: message.url,
						},
						...(extraButtons.post || []),
					],
				},
			],

			content: `**${BOARD_EMOJI} ${count}** | ${
				message.channel.isThread() && message.channel.parent
					? `${message.channel.toString()} (${message.channel.parent.toString()})`
					: message.channel.toString()
			} | ${message.author.toString()}`,

			embeds: [
				{
					color:
						message.type === MessageType.AutoModerationAction
							? 0x99_a1_f2
							: message.type === MessageType.GuildInviteReminder
							? undefined
							: message.member?.displayColor,
					description: censor(await messageToText(message)),

					author: {
						icon_url:
							message.type === MessageType.AutoModerationAction
								? "https://discord.com/assets/e7af5fc8fa27c595d963c1b366dc91fa.gif"
								: message.type === MessageType.GuildInviteReminder
								? "https://discord.com/assets/e4c6bb8de56c299978ec36136e53591a.svg"
								: (message.member ?? message.author).displayAvatarURL(),

						name:
							message.type === MessageType.AutoModerationAction
								? "AutoMod 🤖"
								: message.type === MessageType.GuildInviteReminder
								? "Invite your friends 🤖"
								: (message.member?.displayName ??
										censor(message.author.displayName)) +
								  (message.author.bot ? " 🤖" : ""),
					},

					timestamp:
						message.type === MessageType.GuildInviteReminder
							? undefined
							: message.createdAt.toISOString(),

					footer: message.editedAt ? { text: "Edited" } : undefined,
				},
				...embeds,
			],

			files,
		};
	}

	if (info instanceof Message) return await messageToBoardData(info);

	const onBoard =
		info.onBoard &&
		(await config.channels.board?.messages.fetch(info.onBoard).catch(() => void 0));

	if (onBoard) {
		const linkButton = onBoard.components[0]?.components?.[0];
		const buttons =
			linkButton?.type === ComponentType.Button
				? [...(extraButtons.pre || []), linkButton.toJSON(), ...(extraButtons.post || [])]
				: [...(extraButtons.pre || []), ...(extraButtons.post || [])];

		return {
			allowedMentions: { users: [] },

			components: buttons.length
				? [{ type: ComponentType.ActionRow, components: buttons }]
				: [],

			content: onBoard.content,
			embeds: onBoard.embeds.map((oldEmbed) => oldEmbed.data),
			files: onBoard.attachments.map((attachment) => attachment),
		};
	}

	const channel = await config.guild.channels.fetch(info.channel).catch(() => void 0);

	if (!channel?.isTextBased()) return;

	const message = await channel.messages.fetch(info.source).catch(() => void 0);

	if (!message) return;

	return await messageToBoardData(message);
}
