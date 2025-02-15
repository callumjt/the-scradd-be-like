import {
	ActivityType,
	ApplicationCommandOptionType,
	GuildMember,
	MessageType,
	type CommandInteractionOption,
	AutoModerationActionType,
} from "discord.js";
import config from "../../common/config.js";
import constants from "../../common/constants.js";
import { joinWithAnd } from "../../util/text.js";
import warn from "../punishments/warn.js";
import changeNickname from "./nicknames.js";
import automodMessage from "./automod.js";
import tryCensor, { badWordsAllowed } from "./language.js";
import { commands, defineChatCommand, defineEvent } from "strife.js";
import { escapeMessage } from "../../util/markdown.js";

defineEvent.pre("interactionCreate", async (interaction) => {
	if (!interaction.inGuild() || !interaction.isChatInputCommand()) return true;

	const command = commands[interaction.command?.name ?? ""];
	if (!command) throw new ReferenceError(`Command \`${interaction.command?.name}\` not found`);

	if (
		command.censored === "channel"
			? !badWordsAllowed(interaction.channel)
			: command.censored ?? true
	) {
		const censored = censorOptions(interaction.options.data);

		if (censored.strikes) {
			await interaction.reply({
				ephemeral: true,
				content: `${constants.emojis.statuses.no} ${
					censored.strikes < 1 ? "That’s not appropriate" : "Language"
				}!`,
			});
			await warn(
				interaction.user,
				"Please watch your language!",
				censored.strikes,
				`Used command \`${interaction.toString()}\``,
			);
			return false;
		}
	}

	return true;
});
defineEvent.pre("messageCreate", async (message) => {
	if (message.flags.has("Ephemeral") || message.type === MessageType.ThreadStarterMessage)
		return false;

	if (message.guild?.id === config.guild.id) return await automodMessage(message);
	return true;
});
defineEvent("messageUpdate", async (_, message) => {
	if (
		!message.flags.has("Ephemeral") &&
		message.type !== MessageType.ThreadStarterMessage &&
		message.guild?.id === config.guild.id
	)
		await automodMessage(message.partial ? await message.fetch() : message);
});
defineEvent.pre("messageReactionAdd", async (partialReaction, partialUser) => {
	const reaction = partialReaction.partial ? await partialReaction.fetch() : partialReaction;
	const message = reaction.message.partial ? await reaction.message.fetch() : reaction.message;
	if (message.guild?.id !== config.guild.id) return false;

	if (reaction.emoji.name && !badWordsAllowed(message.channel)) {
		const censored = tryCensor(reaction.emoji.name, 1);
		if (censored) {
			await warn(
				partialUser.partial ? await partialUser.fetch() : partialUser,
				"Please watch your language!",
				censored.strikes,
				`Reacted with :${reaction.emoji.name}:`,
			);
			await reaction.remove();
			return false;
		}
	}
	return true;
});
defineEvent.pre("threadCreate", async (thread, newlyCreated) => {
	if (thread.guild.id !== config.guild.id || !newlyCreated) return false;

	const censored = tryCensor(thread.name);
	if (censored && !badWordsAllowed(thread)) {
		await thread.delete("Bad words");
		return false;
	}
	return true;
});
defineEvent("threadUpdate", async (oldThread, newThread) => {
	if (newThread.guild.id !== config.guild.id) return;

	const censored = tryCensor(newThread.name);
	if (censored && !badWordsAllowed(newThread)) {
		await newThread.setName(oldThread.name, "Censored bad word");
	}
});
defineEvent("guildMemberAdd", async (member) => {
	if (member.guild.id !== config.guild.id) return;
	await changeNickname(member);
});
defineEvent("guildMemberUpdate", async (_, member) => {
	await changeNickname(member);
});
defineEvent.pre("userUpdate", async (_, user) => {
	const member = await config.guild.members.fetch(user).catch(() => void 0);
	if (member) {
		await changeNickname(member);
		return true;
	}
	return false;
});
defineEvent("presenceUpdate", async (_, newPresence) => {
	if (newPresence.guild?.id !== config.guild.id) return;

	const status =
		newPresence.activities[0]?.type === ActivityType.Custom
			? newPresence.activities[0].state
			: newPresence.activities[0]?.name;
	const censored = status && tryCensor(status);
	if (
		censored &&
		config.roles.staff &&
		newPresence.member?.roles.resolve(config.roles.staff.id)
	) {
		await warn(
			newPresence.member,
			"As server representatives, staff members are not allowed to have bad words in their statuses. Please change yours now to avoid another warn.",
			censored.strikes,
			"Set status to " + status,
		);
	}
});

defineChatCommand(
	{
		name: "is-bad-word",
		description: "Checks text for language",

		options: {
			text: {
				type: ApplicationCommandOptionType.String,
				description: "Text to check",
				required: true,
			},
		},

		censored: false,
	},

	async (interaction, options) => {
		const result = tryCensor(options.text);

		const words = result && result.words.flat();
		await interaction.reply({
			ephemeral: true,

			content: words
				? `⚠️ **${words.length} bad word${words.length ? "s" : ""} detected**!\n${
						config.roles.staff &&
						(interaction.member instanceof GuildMember
							? interaction.member.roles.resolve(config.roles.staff.id)
							: interaction.member.roles.includes(config.roles.staff.id))
							? `That text gives **${Math.trunc(result.strikes)} strike${
									result.strikes === 1 ? "" : "s"
							  }**.\n\n`
							: ""
				  }**I detected the following words as bad**: ${joinWithAnd(
						words,
						(word) => `*${escapeMessage(word)}*`,
				  )}`
				: `${constants.emojis.statuses.yes} No bad words found.`,
		});
	},
);

defineEvent("autoModerationActionExecution", async (action) => {
	if (
		action.guild.id === config.guild.id &&
		action.action.type === AutoModerationActionType.SendAlertMessage &&
		action.alertSystemMessageId &&
		tryCensor(action.content)
	) {
		const channel =
			action.action.metadata.channelId &&
			(await config.guild.channels.fetch(action.action.metadata.channelId));
		if (channel && channel.isTextBased())
			await channel.messages.delete(action.alertSystemMessageId);
	}
});

function censorOptions(options: readonly CommandInteractionOption[]): {
	strikes: number;
	words: string[];
} {
	let strikes = 0;
	const words: string[] = [];

	for (const option of options) {
		const censoredValue = (option.value === "string" && tryCensor(option.value)) || undefined;
		const censoredOptions = option.options && censorOptions(option.options);

		strikes += (censoredValue?.strikes ?? 0) + (censoredOptions?.strikes ?? 0);
		words.push(
			...(censoredValue?.words.flat() ?? []),
			...(censoredOptions?.words.flat() ?? []),
		);
	}

	return { strikes, words };
}
