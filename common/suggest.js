import {
	Colors,
	GuildMember,
	Message,
	escapeMarkdown,
	ThreadAutoArchiveDuration,
	EmbedBuilder,
	ChatInputCommandInteraction,
} from "discord.js";
import client, { guild } from "../client.js";

import CONSTANTS from "./CONSTANTS.js";

/**
 * @typedef {object} Answer
 *
 * @property {string} name - A one-word name of the answer.
 * @property {import("discord.js").ColorResolvable} color - A color to set the embed to when the answer is used.
 * @property {string} description - A user-facing description of what using this answer means.
 */

const RATELIMIT_TIMEOUT = 3_000;

export const RATELIMT_MESSAGE =
	"If the thread title doesn’t update immediately, you may have been ratelimited. I will automatically change the title once the ratelimit is up (within the next hour).";

export const DEFAULT_COLOR = Colors.Greyple;

/** @type {{ [key: import("discord.js").Snowflake]: number }} */
const cooldowns = {};
export const FEEDBACK_COOLDOWN = 60_000;

export default class SuggestionChannel {
	/**
	 * Initialize a suggestion channel.
	 *
	 * @param {import("discord.js").TextChannel} channel - The channel to use.
	 */
	constructor(channel) {
		/** @type {import("discord.js").TextChannel} */
		this.channel = channel;
	}

	/**
	 * Post a message in a suggestion channel.
	 *
	 * @param {ChatInputCommandInteraction<"raw" | "cached">} interaction - The interaction to reply to on errors.
	 * @param {{ title: string; description: string }} data - The suggestion information.
	 *
	 * @returns {Promise<false | import("discord.js").Message<true>>} - `false` on errors and the suggestion message on success.
	 */
	async createMessage(interaction, data, defaultAnswer = "Unanswered") {
		const author = interaction.member;

		if (!(author instanceof GuildMember))
			throw new TypeError("interaction.member must be a GuildMember");

		const title = escapeMarkdown(data.title);

		const embed = new EmbedBuilder()
			.setColor(DEFAULT_COLOR)
			.setAuthor({
				iconURL: author.displayAvatarURL(),
				name: author.displayName ?? interaction.user.username,
			})
			.setTitle(title)
			.setDescription(data.description)
			.setFooter({ text: defaultAnswer });

		if ((cooldowns[author.id] || 0) > Date.now()) {
			await interaction.reply({
				content: `${
					CONSTANTS.emojis.statuses.no
				} You can only post a feedback every ${Math.max(
					1,
					Math.round(FEEDBACK_COOLDOWN / 1_000),
				)} seconds. Please wait ${Math.max(
					1,
					Math.round(((cooldowns[author.id] || 0) - Date.now()) / 1_000),
				)} seconds before posting another feedback.`,
				ephemeral: true,
			});

			return false;
		}
		cooldowns[author.id] = Date.now() + FEEDBACK_COOLDOWN;
		const message = await this.channel.send({ embeds: [embed] });
		const thread = await message.startThread({
			autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
			name: `${title ?? ""} | ${defaultAnswer}`,
			reason: `Suggestion or bug report by ${interaction.user.tag}`,
		});

		await thread.members.add(interaction.user.id);

		return message;
	}

	/**
	 * Answer a suggestion.
	 *
	 * @param {ChatInputCommandInteraction<"raw" | "cached">} interaction - The interaction to reply to on errors.
	 * @param {string} answer - The answer to the suggestion.
	 * @param {Answer[]} answers - An object that maps answers to colors.
	 *
	 * @returns {Promise<boolean | "ratelimit">} - If true, you must respond to the interaction with a success message yourself.
	 */
	async answerSuggestion(interaction, answer, answers) {
		if (
			!interaction.channel?.isThread() ||
			interaction.channel.parent?.id !== this.channel.id
		) {
			await interaction.reply({
				content: `${CONSTANTS.emojis.statuses.no} This command can only be used in threads in <#${this.channel}>.`,
				ephemeral: true,
			});

			return false;
		}

		const starter = await interaction.channel.fetchStarterMessage().catch(() => {});
		if (!(interaction.member instanceof GuildMember))
			throw new TypeError("interaction.member must be a GuildMember");

		if (!CONSTANTS.roles.dev || !interaction.member.roles.resolve(CONSTANTS.roles.dev)) {
			await interaction.reply({
				content: `${CONSTANTS.emojis.statuses.no} You don’t have permission to run this command!`,
				ephemeral: true,
			});

			return false;
		}

		const promises = [
			Promise.race([
				new Promise((resolve) => setTimeout(resolve, RATELIMIT_TIMEOUT)),
				interaction.channel.setName(
					interaction.channel.name.replace(/^(.+? \| )?[^|]+$/, "$1" + answer),
					`Thread answered by ${interaction.user.tag}`,
				),
			]),
		];

		if (starter && starter?.author.id === client.user?.id) {
			const embed = starter.embeds[0]
				? EmbedBuilder.from(starter.embeds[0])
				: new EmbedBuilder();

			embed
				.setColor(answers.find(({ name }) => answer === name)?.color ?? DEFAULT_COLOR)
				.setFooter({ text: answer });

			promises.push(starter.edit({ embeds: [embed] }));
		}

		await Promise.all(promises);

		return interaction.channel.name.startsWith(answer + " |") ? true : "ratelimit";
	}

	/**
	 * Edit a suggestion.
	 *
	 * @param {ChatInputCommandInteraction<"raw" | "cached">} interaction - Interaction to respond to on errors.
	 * @param {{ title: null | string; body: null | string }} updated - Updated suggestion.
	 *
	 * @returns {Promise<boolean | "ratelimit">} - If true, you must respond to the interaction with a success message yourself.
	 */
	async editSuggestion(interaction, updated) {
		if (
			!interaction.channel?.isThread() ||
			interaction.channel.parent?.id !== this.channel.id
		) {
			await interaction.reply({
				content: `${CONSTANTS.emojis.statuses.no} This command may only be used in threads in <#${this.channel}>.`,
				ephemeral: true,
			});

			return false;
		}

		const starterMessage = await interaction.channel.fetchStarterMessage().catch(() => {});

		if (!starterMessage || starterMessage.author.id !== client.user?.id) {
			await interaction.reply({
				content: `${CONSTANTS.emojis.statuses.no} Cannot edit this feedback.`,
				ephemeral: true,
			});

			return false;
		}
		const user = await getUserFromSuggestion(starterMessage);
		if (!(interaction.member instanceof GuildMember))
			throw new TypeError("interaction.member must be a GuildMember");

		const isMod = CONSTANTS.roles.mod && interaction.member.roles.resolve(CONSTANTS.roles.mod);
		if (interaction.user.id !== user?.id && (!isMod || (isMod && updated.body))) {
			await interaction.reply({
				content: `${CONSTANTS.emojis.statuses.no} You don’t have permission to use this command.`,
				ephemeral: true,
			});

			return false;
		}

		const embed = starterMessage.embeds[0]
			? EmbedBuilder.from(starterMessage.embeds[0])
			: new EmbedBuilder();

		if (updated.body) embed.setDescription(updated.body);

		const promises = [];

		const title = escapeMarkdown(updated.title ?? "");

		promises.push(
			title
				? Promise.race([
						interaction.channel.setName(
							interaction.channel.name.replace(/(?<=^.+ \| ).+$/, title),
							"Feedback edited",
						),
						new Promise((resolve) => setTimeout(resolve, RATELIMIT_TIMEOUT)),
				  ])
				: Promise.resolve(interaction.channel),
		);

		embed.setTitle(title || embed.data.title || "");

		promises.push(starterMessage.edit({ embeds: [embed] }));

		await Promise.all(promises);

		return (title ? (await interaction.channel.fetch()).name.endsWith(title) : true)
			? true
			: "ratelimit";
	}
}

/**
 * Get the member who made a suggestion.
 *
 * @param {Message} message - The message to get the member from.
 *
 * @returns {Promise<import("discord.js").GuildMember | import("discord.js").User>} - The member who made the suggestion.
 *
 * @todo Change to Message<true> after https://github.com/discordjs/discord.js/pull/8560 lands.
 */
export async function getUserFromSuggestion(message) {
	const author =
		message.author.id === CONSTANTS.robotop
			? message.embeds[0]?.footer?.text.split(": ")[1]
			: /\/(?<userId>\d+)\//.exec(message.embeds[0]?.author?.iconURL ?? "")?.groups?.userId;

	if (author) {
		const fetchedMember =
			(await guild?.members.fetch(author).catch(() => undefined)) ||
			(await client?.users.fetch(author).catch(() => undefined));
		if (fetchedMember) return fetchedMember;
	}

	return message.member ?? message.author;
}
