import { ChannelType, Constants, MessageType, type Message } from "discord.js";
import { client } from "strife.js";
import config from "../../common/config.js";
import constants from "../../common/constants.js";
import {
	getBaseChannel,
	GlobalAnimatedEmoji,
	GlobalBotInvitesPattern,
	InvitesPattern,
} from "../../util/discord.js";
import log, { LoggingErrorEmoji } from "../logging/misc.js";
import { PARTIAL_STRIKE_COUNT } from "../punishments/misc.js";
import warn from "../punishments/warn.js";
import tryCensor, { badWordRegexps, badWordsAllowed } from "./language.js";
import { stripMarkdown } from "../../util/markdown.js";

const WHITELISTED_INVITE_GUILDS = new Set([
	config.guild.id,
	"751206349614088204", // Scratch Addons development
	"837024174865776680", // TurboWarp
	constants.testingServerId,
	"461575285364752384", // 9th Tail Bot Hub
	"898383289059016704", // Scratch Addons SMP Archive
	"945340853189247016", // ScratchTools
]);

export default async function automodMessage(message: Message) {
	const allowBadWords = badWordsAllowed(message.channel);
	const baseChannel = getBaseChannel(message.channel);

	const animatedEmojis = message.content.match(GlobalAnimatedEmoji);

	const badAnimatedEmojis =
		animatedEmojis &&
		animatedEmojis.length > 15 &&
		Math.floor((animatedEmojis.length - 16) / 10) * PARTIAL_STRIKE_COUNT;

	let needsDelete = false;

	if (baseChannel?.id !== config.channels.bots?.id && typeof badAnimatedEmojis === "number") {
		needsDelete = true;
		await warn(
			message.author,
			"Please don’t post that many animated emojis!",
			badAnimatedEmojis,
			animatedEmojis?.join(""),
		);
		await message.channel.send(
			`${
				constants.emojis.statuses.no
			} ${message.author.toString()}, less animated emojis please!`,
		);
	}

	const links = message.content.match(InvitesPattern) ?? [];
	const invites = await Promise.all(
		links.map(
			async (link) =>
				[
					link,
					await client.fetchInvite(link.split("/").at(-1) ?? link).catch(() => void 0),
				] as const,
		),
	);

	if (!allowBadWords) {
		if (
			!message.author.bot &&
			config.channels.advertise &&
			config.channels.advertise.id !== baseChannel?.id &&
			config.channels.announcements?.id !== baseChannel?.id &&
			baseChannel?.type !== ChannelType.GuildAnnouncement
		) {
			const badInvites = invites
				.filter(
					([, invite]) =>
						invite?.guild && !WHITELISTED_INVITE_GUILDS.has(invite.guild.id),
				)
				.map(([link]) => link);

			if (badInvites.length) {
				needsDelete = true;
				await warn(
					message.author,
					"Please don’t send server invites in that channel!",
					badInvites.length,
					badInvites.join("\n"),
				);
				await message.channel.send(
					`${
						constants.emojis.statuses.no
					} ${message.author.toString()}, only post invite links in ${config.channels.advertise.toString()}!`,
				);
			}

			const bots = message.content.match(GlobalBotInvitesPattern);
			if (bots?.length) {
				needsDelete = true;
				await warn(
					message.author,
					"Please don’t post bot invite links!",
					bots.length,
					bots.join("\n"), // todo: improve this
				);
				await message.channel.send(
					`${
						constants.emojis.statuses.no
					} ${message.author.toString()}, bot invites go to ${config.channels.advertise.toString()}!`,
				);
			}
		}

		const badWords = [
			tryCensor(stripMarkdown(message.content)),
			...message.stickers.map(({ name }) => tryCensor(name)),
			...invites.map(([, invite]) => !!invite?.guild && tryCensor(invite.guild.name)),
		].reduce(
			(bad, censored) =>
				typeof censored === "boolean"
					? bad
					: {
							strikes: bad.strikes + censored.strikes,
							words: bad.words.map((words, index) => [
								...words,
								...(censored.words[index] ?? []),
							]),
					  },
			{ strikes: 0, words: Array.from<string[]>({ length: badWordRegexps.length }).fill([]) },
		);
		if (badWords.strikes) needsDelete = true;

		const badEmbedWords = message.embeds
			.flatMap((embed) => [
				embed.description,
				embed.title,
				embed.footer?.text,
				embed.author?.name,
				...embed.fields.flatMap((field) => [field.name, field.value]),
			])
			.reduce(
				(bad, current) => {
					const censored = tryCensor(current || "", 1);
					return censored
						? {
								strikes: bad.strikes + censored.strikes,
								words: bad.words.map((words, index) => [
									...words,
									...(censored.words[index] ?? []),
								]),
						  }
						: bad;
				},
				{
					strikes: 0,
					words: Array.from<string[]>({ length: badWordRegexps.length }).fill([]),
				},
			);

		if (
			badEmbedWords.strikes &&
			!(Constants.NonSystemMessageTypes as MessageType[]).includes(message.type)
		)
			needsDelete = true;

		const languageStrikes = badWords.strikes + badEmbedWords.strikes;
		if (needsDelete) {
			if (message.deletable) {
				await message.delete();
				if (badWords.strikes)
					await message.channel.send(
						`${constants.emojis.statuses.no} ${message.author.toString()}, ${
							languageStrikes < 1 ? "that’s not appropriate" : "language"
						}!`,
					);
			} else {
				await log(`${LoggingErrorEmoji} Missing permissions to delete ${message.url}`);
			}
		} else if (badEmbedWords.strikes) {
			await message.suppressEmbeds();
			await message.reply(
				`${constants.emojis.statuses.no} ${message.author.toString()}, ${
					languageStrikes < 1 ? "that’s not appropriate" : "language"
				}!`,
			);
		}

		if (badWords.strikes || badEmbedWords.strikes) {
			await warn(
				message.interaction?.user ?? message.author,
				"Please watch your language!",
				languageStrikes,
				[...badEmbedWords.words.flat(), ...badWords.words.flat()].join(", "),
			);
		}
	}

	return !needsDelete;
}
