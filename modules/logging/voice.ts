import { unifiedDiff } from "difflib";
import {
	type APIGuildScheduledEvent,
	AuditLogEvent,
	ChannelType,
	GuildAuditLogsEntry,
	GuildScheduledEvent,
	type PartialGuildScheduledEvent,
	VoiceState,
	GuildScheduledEventStatus,
	time,
} from "discord.js";
import config from "../../common/config.js";
import log, { LoggingEmojis, extraAuditLogsInfo } from "./misc.js";

export async function guildScheduledEventCreate(
	entry: GuildAuditLogsEntry<AuditLogEvent.GuildScheduledEventCreate>,
) {
	await log(
		`${LoggingEmojis.Event} Event scheduled${extraAuditLogsInfo(entry)}\n${
			entry.reason?.includes("\n") ? "\n" : ""
		}${entry.target.url}`,
		"voice",
	);
}
export async function guildScheduledEventUpdate(
	entry: GuildAuditLogsEntry<AuditLogEvent.GuildScheduledEventUpdate>,
) {
	let locationChanged = false;
	let timeChanged = false;

	for (const change of entry.changes) {
		const key = change.key as keyof APIGuildScheduledEvent | "image_hash" | "location";
		switch (key) {
			case "name": {
				await log(
					`${LoggingEmojis.Event} Event ${entry.target.name}’s topic changed to ${
						change.new
					} (${change.old})${extraAuditLogsInfo(entry)}\n${
						entry.reason?.includes("\n") ? "\n" : ""
					}${entry.target.url}`,
					"voice",
				);
				break;
			}
			case "description": {
				await log(
					`${LoggingEmojis.Event} Event ${
						entry.target.name
					}’s description changed${extraAuditLogsInfo(entry)}\n${
						entry.reason?.includes("\n") ? "\n" : ""
					}${entry.target.url}`,
					"voice",
					{
						files: [
							{
								content: unifiedDiff(
									`${
										(change.old as APIGuildScheduledEvent["description"]) ?? ""
									}`.split("\n"),
									`${entry.target.description ?? ""}`.split("\n"),
									{ lineterm: "" },
								)
									.join("\n")
									.replace(/^-{3} \n\+{3} \n/, ""),

								extension: "diff",
							},
						],
					},
				);
				break;
			}
			case "channel_id":
			case "entity_type":
			case "location": {
				locationChanged ||= true;
				break;
			}
			case "image_hash": {
				const url = entry.target.coverImageURL({ size: 128 });
				await log(
					`${LoggingEmojis.Event} Event ${entry.target.name}’s cover image ${
						url ? "changed" : "removed"
					}${extraAuditLogsInfo(entry)}\n${entry.reason?.includes("\n") ? "\n" : ""}${
						entry.target.url
					}`,
					"voice",
					{ files: url ? [url] : [] },
				);
				break;
			}
			case "scheduled_end_time":
			case "scheduled_start_time": {
				timeChanged ||= true;
				break;
			}
			case "status": {
				await log(
					`${LoggingEmojis.Event} Event ${entry.target.name} ${
						{
							[GuildScheduledEventStatus.Active]: "started",
							[GuildScheduledEventStatus.Canceled]: "canceled",
							[GuildScheduledEventStatus.Completed]: "ended",
							[GuildScheduledEventStatus.Scheduled]: "scheduled",
						}[entry.target.status]
					}${extraAuditLogsInfo(entry)}\n${entry.reason?.includes("\n") ? "\n" : ""}${
						entry.target.url
					}`,
					"voice",
				);
			}
		}

		if (locationChanged) {
			await log(
				`${LoggingEmojis.Event} Event ${entry.target.name} moved to ${
					entry.target.channel?.toString() ??
					entry.target.entityMetadata?.location ??
					"an external location"
				}${extraAuditLogsInfo(entry)}\n${entry.reason?.includes("\n") ? "\n" : ""}${
					entry.target.url
				}`,
				"voice",
			);
		}
		if (timeChanged) {
			const start = entry.target.scheduledStartAt;
			const end = entry.target.scheduledEndAt;
			await log(
				`${LoggingEmojis.Event} Event ${entry.target.name} rescheduled${
					start ?? end
						? ` to ${time(start ?? end ?? new Date())}${
								end && start ? `-${time(end)}` : ""
						  }`
						: ""
				}${extraAuditLogsInfo(entry)}\n${entry.reason?.includes("\n") ? "\n" : ""}${
					entry.target.url
				}`,
			);
		}
	}
}

export async function voiceStateUpdate(oldState: VoiceState, newState: VoiceState) {
	if (!newState.member || newState.guild.id !== config.guild.id) return;

	if (oldState.channel?.id !== newState.channel?.id && !newState.member.user.bot) {
		if (oldState.channel && oldState.channel.type !== ChannelType.GuildStageVoice) {
			await log(
				`${
					LoggingEmojis.Voice
				} ${newState.member.toString()} left voice channel ${oldState.channel.toString()}`,
				"voice",
			);
		}

		if (newState.channel && newState.channel.type !== ChannelType.GuildStageVoice) {
			await log(
				`${
					LoggingEmojis.Voice
				} ${newState.member.toString()} joined voice channel ${newState.channel.toString()}, ${
					newState.mute ? "" : "un"
				}muted and ${newState.deaf ? "" : "un"}deafened`,
				"voice",
			);
		}

		return;
	}

	if (!newState.channel) return;

	if (Boolean(oldState.suppress) !== Boolean(newState.suppress)) {
		await log(
			`${LoggingEmojis.Voice} ${newState.member.toString()} ${
				newState.suppress ? "moved to the audience" : "became a speaker"
			} in ${newState.channel.toString()}`,
			"voice",
		);
	}

	if (newState.suppress && newState.channel.type === ChannelType.GuildStageVoice) return;

	if (Boolean(oldState.selfDeaf) !== Boolean(newState.selfDeaf)) {
		await log(
			`${LoggingEmojis.Voice} ${newState.member.toString()} ${
				newState.selfDeaf ? "" : "un"
			}deafened in ${newState.channel.toString()}`,
			"voice",
		);
	}

	if (Boolean(oldState.selfMute) !== Boolean(newState.selfMute)) {
		await log(
			`${LoggingEmojis.Voice} ${newState.member.toString()} ${
				newState.selfMute ? "" : "un"
			}muted in ${newState.channel.toString()}`,
			"voice",
		);
	}

	if (Boolean(oldState.selfVideo) !== Boolean(newState.selfVideo)) {
		await log(
			`${LoggingEmojis.Voice} ${newState.member.toString()} turned camera ${
				newState.selfVideo ? "on" : "off"
			} in ${newState.channel.toString()}`,
			"voice",
		);
	}

	if (Boolean(oldState.serverDeaf) !== Boolean(newState.serverDeaf)) {
		await log(
			`${LoggingEmojis.Voice} ${newState.member.toString()} was ${
				newState.serverDeaf ? "" : "un-"
			}server deafened`,
			"voice",
		);
	}

	if (Boolean(oldState.serverMute) !== Boolean(newState.serverMute)) {
		await log(
			`${LoggingEmojis.Voice} ${newState.member.toString()} was ${
				newState.serverMute ? "" : "un-"
			}server muted`,
			"voice",
		);
	}

	if (Boolean(oldState.streaming) !== Boolean(newState.streaming)) {
		await log(
			`${LoggingEmojis.Voice} ${newState.member.toString()} ${
				newState.streaming ? "started" : "stopped"
			} screen sharing in ${newState.channel.toString()}`,
			"voice",
		);
	}
}
export async function guildScheduledEventDelete(
	event: GuildScheduledEvent | PartialGuildScheduledEvent,
) {
	if (event.guildId !== config.guild.id || event.partial) return;

	await log(`${LoggingEmojis.Event} Event ${event.name} (ID: ${event.id}) removed`, "voice");
}
