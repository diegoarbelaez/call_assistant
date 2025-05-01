import Fastify from "fastify";
import WebSocket, { WebSocketServer } from "ws";
import dotenv from "dotenv";
import fastifyFormBody from "@fastify/formbody";
import fastifyWs from "@fastify/websocket";
import twilio from "twilio";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Carga las variables de entorno desde un archivo .env a process.env.
 */
dotenv.config();

/**
 * Recupera la configuración de OpenAI y Twilio desde las variables de entorno.
 */
const {
  OPENAI_API_KEY,
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_PHONE_NUMBER,
} = process.env;

/**
 * Valida que la clave API de OpenAI esté configurada.
 */
if (!OPENAI_API_KEY) {
  console.error("Missing OpenAI API key. Please set it in the .env file.");
  process.exit(1);
}

/**
 * Valida que las credenciales esenciales de Twilio estén configuradas.
 */
if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
  console.error(
    "Missing Twilio credentials (Account SID, Auth Token, or Phone Number). Please set them in the .env file."
  );
  process.exit(1);
}

/**
 * Inicializa el cliente de la API REST de Twilio usando las credenciales de las variables de entorno.
 * Se utiliza para realizar llamadas salientes.
 */
const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

/**
 * Inicializa la instancia del servidor web Fastify.
 */
const fastify = Fastify();

/**
 * Registra el plugin de Fastify para parsear cuerpos de solicitud codificados como URL (formato formulario).
 */
fastify.register(fastifyFormBody);
/**
 * Registra el plugin de Fastify para manejar conexiones WebSocket.
 */
fastify.register(fastifyWs);

// --- Constants ---

/**
 * Función para reemplazar placeholders en las instrucciones con datos (falsos por ahora).
 * @param {string} instructions - El string de instrucciones crudas con placeholders.
 * @returns {string} - El string de instrucciones con los placeholders reemplazados.
 */
const loadPrecallData = (instructions) => {
  
  
  
    // PARA EL CASO DE UNA ENTREGA DE UN PRODUCTO
  const fakeData = {
    nombre_cliente: "Ricardo Montaño",
    fecha_entrega: "Mañana, 2 de Mayo, entre 3 PM y 5 PM",
    direccion_entrega: "Calle 66 con Autopista Sur, Apto 401, en Cali Valle",
    id_pedido: "PED-123456789",
    valor_pedido: "130.000 Pesos",
    productos: "un par de zapatillas deportivas y una camiseta polo",
  };

  // PARA EL CASO DE UNA CITA MÉDICA
  /*const fakeData = {
    nombre_cliente: "Paola Cárdenas",
    fecha_cita: "Mañana, 2 de Mayo, 10:30AM",
    direccion_cita: "Centro Médico Tecnon",
    nombre_doctor: "Dr. Ramón Vilarovira ",
    procedimiento: "Mamoplastia de Aumento",
  };*/

  let processedInstructions = instructions;
  for (const key in fakeData) {
    // Usamos una expresión regular global para reemplazar todas las ocurrencias
    const regex = new RegExp(`{{\s*${key}\s*}}`, "g");
    processedInstructions = processedInstructions.replace(regex, fakeData[key]);
  }
  console.log("Instrucciones:", processedInstructions);
  return processedInstructions;
};

/**
 * Lee las instrucciones del agente desde el archivo instructions.txt.
 */
let agentInstructions;
try {
  // --- Lectura y procesamiento de Instrucciones ---
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  //### INSTRUCCIONES PARA LA LLAMADA ###

  // Construye la ruta al archivo de instrucciones de forma segura
  const instructionsPath = path.join(__dirname, "instructions.txt");
  const rawInstructions = fs.readFileSync(instructionsPath, "utf8");
  console.log("Instrucciones crudas cargadas desde instructions_clinica.txt");

  // Reemplazar placeholders con datos falsos
  agentInstructions = loadPrecallData(rawInstructions);
  console.log(
    "Instrucciones procesadas con datos de ejemplo:",
    agentInstructions.substring(0, 200) + "..."
  ); // Loguea el inicio para verificar
} catch (err) {
  console.error("Error al leer el archivo instructions_clinica.txt:", err);
  console.error(
    "Asegúrate de que el archivo instructions_clinica.txt existe en el mismo directorio que app.js y tiene permisos de lectura."
  );
  console.warn("Usando un mensaje de sistema genérico como fallback.");
  // Fallback a un mensaje genérico si no se puede leer el archivo
  agentInstructions = "You are a helpful AI assistant.";
}

/**
 * El modelo de voz específico que usará OpenAI para la conversión de texto a voz.
 */
const VOICE = "alloy";
/**
 * El puerto en el que escuchará el servidor. Usa la variable de entorno o por defecto 5050.
 */
const PORT = process.env.PORT || 5050;

/**
 * Lista de tipos de eventos de la API Realtime de OpenAI para registrar en la consola con fines de depuración.
 */
const LOG_EVENT_TYPES = [
  "error",
  "response.content.done",
  "rate_limits.updated",
  "response.done",
  "input_audio_buffer.committed",
  "input_audio_buffer.speech_stopped",
  "input_audio_buffer.speech_started",
  "session.created",
];

/**
 * Bandera para habilitar/deshabilitar logs detallados de temporización para la latencia de respuesta de la IA.
 */
const SHOW_TIMING_MATH = false;

// --- Routes ---

/**
 * Ruta raíz (GET /) para una verificación básica de estado.
 * Responde con un mensaje JSON simple indicando que el servidor está en ejecución.
 */
fastify.get("/", async (request, reply) => {
  reply.send({ message: "Twilio Media Stream Server is running!" });
});

/**
 * Ruta (POST /make-call) para iniciar una llamada saliente a través de Twilio.
 * Espera 'to' (número de teléfono de destino) y 'publicHostname' (URL pública, ej: ngrok) en el cuerpo de la solicitud.
 * Genera TwiML para conectar la llamada respondida al WebSocket /media-stream.
 */
fastify.post("/make-call", async (request, reply) => {
  const { to, publicHostname } = request.body;

  if (!to) {
    reply
      .status(400)
      .send({ error: 'Missing "to" phone number in request body' });
    return;
  }
  if (!publicHostname) {
    reply.status(400).send({
      error:
        'Missing "publicHostname" (e.g., your ngrok URL without https://) in request body',
    });
    return;
  }

  try {
    // Usa el cliente de Twilio para crear una nueva llamada.
    const call = await twilioClient.calls.create({
      to: to, // Destination number
      from: TWILIO_PHONE_NUMBER, // Twilio phone number from .env
      // Instrucciones TwiML ejecutadas cuando se responde la llamada.
      twiml: `<Response>
                        <Connect>
                            {/* Connect the call to a bi-directional media stream *}/
                            <Stream url="wss://${publicHostname}/media-stream" />
                        </Connect>
                    </Response>`,
      record: true, // Habilitar grabación de la llamada en Twilio
    });
    console.log(`Call initiated with SID: ${call.sid}`);
    reply.send({ message: "Call initiated successfully", callSid: call.sid });
  } catch (error) {
    console.error("Error initiating call:", error);
    reply
      .status(500)
      .send({ error: "Failed to initiate call", details: error.message });
  }
});

/**
 * Ruta WebSocket (GET /media-stream) que maneja el flujo de audio bidireccional.
 * Aquí es donde Twilio se conecta después de que se responde la llamada saliente.
 * Gestiona las conexiones WebSocket tanto con Twilio como con OpenAI.
 */
fastify.register(async (fastify) => {
  fastify.get("/media-stream", { websocket: true }, (connection, req) => {
    // Nota: 'connection' es el objeto de conexión WebSocket de Fastify.
    // 'connection.socket' es la instancia subyacente del WebSocket 'ws'.
    console.log("Twilio WebSocket client connected");

    // --- Estado específico de la conexión ---
    let streamSid = null; // SID del Stream de Twilio, recibido en el mensaje 'start'.
    let latestMediaTimestamp = 0; // Rastrea la marca de tiempo más reciente de los mensajes de medios de Twilio.
    let lastAssistantItem = null; // Almacena el ID del último elemento de respuesta de la IA para posible truncamiento.
    let markQueue = []; // Cola para rastrear mensajes 'mark' pendientes enviados a Twilio.
    let responseStartTimestampTwilio = null; // Marca de tiempo cuando comenzó a reproducirse la respuesta de audio actual de la IA.

    /**
     * Establece la conexión WebSocket con la API Realtime de OpenAI.
     */
    const openAiWs = new WebSocket(
      "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01",
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "OpenAI-Beta": "realtime=v1", // Encabezado requerido para la API realtime
        },
      }
    );

    /**
     * Envía la actualización de configuración inicial a la sesión de OpenAI.
     * Configura formatos de audio, voz, instrucciones, detección de turno, etc.
     */
    const initializeSession = () => {
      console.log("Attempting to initialize OpenAI session...");
      const sessionUpdate = {
        type: "session.update",
        session: {
          turn_detection: { type: "server_vad" }, // Use server-side Voice Activity Detection
          input_audio_format: "g711_ulaw", // Format expected from Twilio (audio/x-mulaw)
          output_audio_format: "g711_ulaw", // Format to send back to Twilio
          voice: VOICE, // Desired AI voice
          instructions: agentInstructions, // Instrucciones cargadas desde archivo
          modalities: ["text", "audio"], // Enable both text and audio I/O
          temperature: 0.8, // AI creativity setting
        },
      };
      console.log("Sending session update:", JSON.stringify(sessionUpdate));
      openAiWs.send(JSON.stringify(sessionUpdate));

      // Desencadena que la IA diga su saludo inicial.
      sendInitialConversationItem();
    };

    /**
     * Envía el mensaje inicial a OpenAI para que la IA hable primero.
     * También envía un 'response.create' para indicar a OpenAI que genere la respuesta.
     */
    const sendInitialConversationItem = () => {
      console.log("Attempting to send initial conversation item to OpenAI...");
      const initialConversationItem = {
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user", // Simula un mensaje de usuario para dar el pie a la IA
          content: [
            {
              type: "input_text",
              text: "Inicia la llamada según tus instrucciones y saluda al paciente.",
            },
          ],
        },
      };
      if (SHOW_TIMING_MATH)
        console.log(
          "Sending initial conversation item:",
          JSON.stringify(initialConversationItem)
        );
      openAiWs.send(JSON.stringify(initialConversationItem));
      openAiWs.send(JSON.stringify({ type: "response.create" })); // Indica a OpenAI que genere la respuesta
    };

    /**
     * Maneja el evento 'input_audio_buffer.speech_started' de OpenAI.
     * Si el usuario comienza a hablar mientras la IA está hablando, esta función
     * envía un evento de truncamiento a OpenAI para detener la reproducción de audio actual de la IA
     * y limpia el búfer de medios de Twilio.
     */
    const handleSpeechStartedEvent = () => {
      // Verifica si la IA está hablando actualmente (markQueue tiene elementos) y si tenemos información de tiempo
      if (markQueue.length > 0 && responseStartTimestampTwilio != null) {
        const elapsedTime = latestMediaTimestamp - responseStartTimestampTwilio;
        if (SHOW_TIMING_MATH)
          console.log(
            `Calculating elapsed time for truncation: ${latestMediaTimestamp} - ${responseStartTimestampTwilio} = ${elapsedTime}ms`
          );

        // Si tenemos el ID de la respuesta de IA que se está truncando
        if (lastAssistantItem) {
          // Envía evento a OpenAI para cortar la reproducción de audio después de elapsedTime
          const truncateEvent = {
            type: "conversation.item.truncate",
            item_id: lastAssistantItem,
            content_index: 0,
            audio_end_ms: elapsedTime,
          };
          if (SHOW_TIMING_MATH)
            console.log(
              "Sending truncation event:",
              JSON.stringify(truncateEvent)
            );
          openAiWs.send(JSON.stringify(truncateEvent));
        }

        // Envía un evento 'clear' a Twilio para vaciar su búfer de medios inmediatamente.
        connection.socket.send(
          JSON.stringify({
            // Ensure using connection.socket
            event: "clear",
            streamSid: streamSid,
          })
        );

        // Reinicia las variables de estado de interrupción
        markQueue = [];
        lastAssistantItem = null;
        responseStartTimestampTwilio = null;
      }
    };

    /**
     * Envía un mensaje 'mark' al Media Stream de Twilio.
     * Los mensajes Mark ayudan a Twilio a sincronizar la reproducción de audio y gestionar búferes.
     * Se llama después de enviar cada fragmento de audio de OpenAI a Twilio.
     */
    const sendMark = (connection, streamSid) => {
      // Asegura que el socket subyacente exista y esté abierto
      if (
        streamSid &&
        connection &&
        connection.socket &&
        connection.socket.readyState === WebSocket.OPEN
      ) {
        const markEvent = {
          event: "mark",
          streamSid: streamSid,
          mark: { name: "responsePart" }, // El nombre ayuda a identificar el propósito del mark
        };
        try {
          // Envía el mensaje mark a través del WebSocket subyacente
          connection.socket.send(JSON.stringify(markEvent));
          // Añade a la cola para rastrear que un mensaje mark está pendiente de confirmación por Twilio
          markQueue.push("responsePart");
        } catch (markError) {
          console.error(
            `Error sending mark message to Twilio (Stream SID: ${streamSid}):`,
            markError
          );
          console.error(
            "Twilio WebSocket readyState during mark error:",
            connection.socket ? connection.socket.readyState : "N/A"
          );
        }
      }
    };

    // --- Manejadores de Eventos WebSocket OpenAI ---

    /**
     * Maneja el evento 'open' para la conexión WebSocket de OpenAI.
     * Inicializa la sesión de OpenAI poco después de conectar.
     */
    openAiWs.on("open", () => {
      console.log("Connected to the OpenAI Realtime API");
      console.log("OpenAI WebSocket opened. Initializing session soon...");
      // Espera brevemente antes de inicializar para asegurar la preparación completa
      setTimeout(initializeSession, 100);
    });

    /**
     * Maneja los mensajes entrantes desde el WebSocket de OpenAI.
     * Procesa eventos y reenvía los mensajes delta de audio a Twilio.
     */
    openAiWs.on("message", (data) => {
      try {
        const response = JSON.parse(data.toString()); // Parsea el JSON entrante

        // Registra tipos de eventos específicos si está habilitado
        if (LOG_EVENT_TYPES.includes(response.type)) {
          console.log(`Received event: ${response.type}`, response);
        }

        // Si es un fragmento de audio de la IA
        if (response.type === "response.audio.delta" && response.delta) {
          // Prepara el formato de mensaje esperado por Twilio Media Streams
          const audioDelta = {
            event: "media",
            streamSid: streamSid,
            media: { payload: response.delta }, // Datos de audio codificados en Base64
          };

          // Verifica si el WebSocket de Twilio sigue abierto antes de enviar
          if (
            connection &&
            connection.socket &&
            connection.socket.readyState === WebSocket.OPEN
          ) {
            try {
              // Envía el fragmento de audio a Twilio a través del socket subyacente
              connection.socket.send(JSON.stringify(audioDelta));
            } catch (sendError) {
              console.error("Error sending audio delta to Twilio:", sendError);
              console.error(
                "Twilio WebSocket readyState:",
                connection.socket ? connection.socket.readyState : "N/A"
              );
            }
          } else {
            console.warn(
              `Skipping send to Twilio, WebSocket readyState is: ${
                connection && connection.socket
                  ? connection.socket.readyState
                  : "N/A"
              } (Expected ${WebSocket.OPEN})`
            );
          }

          // Track timing and item ID for interruption handling
          if (!responseStartTimestampTwilio) {
            responseStartTimestampTwilio = latestMediaTimestamp;
            if (SHOW_TIMING_MATH)
              console.log(
                `Setting start timestamp for new response: ${responseStartTimestampTwilio}ms`
              );
          }
          if (response.item_id) {
            lastAssistantItem = response.item_id;
          }

          // Envía un mensaje mark después de enviar audio para ayudar con la sincronización de reproducción
          sendMark(connection, streamSid);
        }

        // Si OpenAI detecta que el usuario comenzó a hablar, maneja la posible interrupción
        if (response.type === "input_audio_buffer.speech_started") {
          handleSpeechStartedEvent();
        }
      } catch (error) {
        // Registra errores al procesar mensajes de OpenAI
        console.error(
          "Error processing OpenAI message:",
          error,
          "Raw message:",
          data.toString()
        );
      }
    });

    /**
     * Maneja el evento 'close' para la conexión WebSocket de OpenAI.
     * Registra los detalles de la desconexión y potencialmente cierra la conexión de Twilio.
     */
    openAiWs.on("close", (code, reason) => {
      console.log(
        `Disconnected from the OpenAI Realtime API. Code: ${code}, Reason: ${reason.toString()}`
      );
      // Si OpenAI se desconecta inesperadamente, intenta cerrar también la conexión de Twilio
      if (
        connection &&
        connection.socket &&
        connection.socket.readyState === WebSocket.OPEN
      ) {
        console.log("Closing Twilio WebSocket due to OpenAI disconnect.");
        connection.socket.close();
      }
    });

    /**
     * Maneja errores en la conexión WebSocket de OpenAI.
     * Registra el error y potencialmente cierra la conexión de Twilio.
     */
    openAiWs.on("error", (error) => {
      console.error("Error in the OpenAI WebSocket:", error);
      // Si ocurre un error con OpenAI, intenta cerrar la conexión de Twilio
      if (
        connection &&
        connection.socket &&
        connection.socket.readyState === WebSocket.OPEN
      ) {
        console.log("Closing Twilio WebSocket due to OpenAI error.");
        connection.socket.close();
      }
    });

    // --- Manejadores de Eventos WebSocket Twilio (Adjuntos a connection.socket) ---

    // Verifica si el socket subyacente existe antes de adjuntar listeners
    if (connection.socket) {
      /**
       * Maneja los mensajes entrantes desde el WebSocket de Twilio ('connection.socket').
       * Procesa eventos de medios (audio), inicio (start) y marca (mark).
       * Reenvía los medios de audio entrantes al WebSocket de OpenAI.
       */
      connection.socket.on("message", (message) => {
        try {
          const data = JSON.parse(message.toString()); // Parsea el JSON entrante

          switch (data.event) {
            // Si es un fragmento de audio del llamante
            case "media":
              latestMediaTimestamp = data.media.timestamp; // Actualiza la última marca de tiempo
              // Verifica si la conexión de OpenAI está abierta antes de reenviar
              if (openAiWs.readyState === WebSocket.OPEN) {
                // Prepara mensaje para OpenAI
                const audioAppend = {
                  type: "input_audio_buffer.append",
                  audio: data.media.payload, // Audio codificado en Base64
                };
                // Envía fragmento de audio a OpenAI
                openAiWs.send(JSON.stringify(audioAppend));
              }
              break;
            // Cuando comienza el stream de Twilio
            case "start":
              streamSid = data.start.streamSid; // Almacena el SID del Stream
              console.log(
                `Twilio media stream started (Stream SID: ${streamSid})`
              );
              // Reinicia variables de temporización para el nuevo stream
              responseStartTimestampTwilio = null;
              latestMediaTimestamp = 0;
              break;
            // Cuando Twilio confirma un mensaje 'mark' enviado previamente
            case "mark":
              // Elimina el mark confirmado de la cola
              if (markQueue.length > 0) {
                markQueue.shift();
              }
              break;
            // Maneja otros eventos potenciales
            default:
              console.log(
                "Recibido evento no multimedia de Twilio:",
                data.event
              );
              break;
          }
        } catch (error) {
          // Registra errores al procesar mensajes de Twilio
          console.error(
            "Error processing Twilio message:",
            error,
            "Raw message:",
            message.toString()
          );
        }
      });

      /**
       * Maneja el evento 'close' para la conexión WebSocket de Twilio.
       * Registra detalles de la desconexión y cierra la conexión de OpenAI si aún está abierta.
       */
      connection.socket.on("close", (code, reason) => {
        console.log(
          `Twilio WebSocket client disconnected. Code: ${code}, Reason: ${reason.toString()}`
        );
        // Si Twilio se desconecta, cierra la conexión de OpenAI
        if (openAiWs.readyState === WebSocket.OPEN) {
          console.log("Closing OpenAI WebSocket due to Twilio disconnect.");
          openAiWs.close();
        }
      });

      /**
       * Maneja errores en la conexión WebSocket de Twilio.
       * Registra el error y cierra la conexión de OpenAI si aún está abierta.
       */
      connection.socket.on("error", (error) => {
        console.error("Error in Twilio WebSocket connection:", error);
        // Si ocurre un error con Twilio, cierra la conexión de OpenAI
        if (openAiWs.readyState === WebSocket.OPEN) {
          console.log("Closing OpenAI WebSocket due to Twilio error.");
          openAiWs.close();
        }
      });
    } else {
      // Error de respaldo si no se encontró el socket subyacente
      console.error(
        "Could not attach listeners: connection.socket is undefined"
      );
    }
  });
});

/**
 * Inicia el servidor Fastify, escuchando en el PUERTO especificado.
 */
fastify.listen({ port: PORT }, (err) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Server is listening on port ${PORT}`);
});
