import type { InteractionEventInput } from "../contracts/interaction-event.types";

import { addInteractionEventJob } from "../queues/interaction.queue";
import { interactionEventRepository } from "../repositories/interaction-event.repository";

export class InteractionEventPublisher {
  async publish(input: InteractionEventInput) {
    const event = await interactionEventRepository.createEvent(input);

    if (!event) {
      throw new Error("Failed to create interaction event");
    }

    await addInteractionEventJob(event.id);

    return event;
  }
}

export const interactionEventPublisher = new InteractionEventPublisher();
