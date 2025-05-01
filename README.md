# Asistente de Llamadas IA con Twilio y OpenAI

Este proyecto implementa un asistente de voz conversacional capaz de realizar llamadas telefónicas salientes utilizando la API de Twilio y mantener una conversación en tiempo real con la persona que responde, gracias a la API Realtime de OpenAI (usando el modelo GPT-4o).

El caso de uso principal demostrado es el de un asistente que llama para confirmar detalles de una entrega de un pedido de ecommerce o una cita médica, pero las instrucciones del asistente son configurables.

## ¿Qué hace?

1.  **Realiza Llamadas Salientes:** Utiliza la API REST de Twilio para iniciar una llamada a un número de teléfono especificado.
2.  **Conecta Audio Bidireccional:** Cuando la persona responde, la llamada se conecta a un servidor WebSocket local usando Twilio Media Streams.
3.  **Transmite a OpenAI:** El servidor WebSocket reenvía el audio recibido de Twilio en tiempo real al API Realtime de OpenAI.
4.  **Genera Respuestas IA:** OpenAI procesa el audio, lo transcribe, genera una respuesta de acuerdo a las instrucciones proporcionadas, y convierte esa respuesta de vuelta a audio.
5.  **Devuelve Audio a Twilio:** El servidor WebSocket recibe el audio generado por OpenAI y lo reenvía a Twilio Media Streams para que la persona en la llamada lo escuche.
6.  **Conversación en Tiempo Real:** Este ciclo permite una conversación fluida y de baja latencia entre la persona y la IA.
7.  **Instrucciones Configurables:** La personalidad, el contexto, las tareas y el estilo del asistente de IA se definen en un archivo de texto externo (`instructions.txt`), permitiendo modificar fácilmente el comportamiento de la IA.
8.  **Inyección de Datos:** Las instrucciones pueden contener variables (placeholders como `{{nombre_cliente}}`) que se reemplazan con datos específicos (actualmente datos de ejemplo) antes de iniciar la conversación.
9.  **Grabación de Llamada (Opcional):** Se ha habilitado la opción para que Twilio grabe la llamada (`record: true`).

## ¿Cómo funciona (a grandes rasgos)?

```
+-----------------+      +----------------------+      +-----------------+      +-----------------+
| Persona (Móvil) | ---- |    Twilio Cloud      | ---- | Tu Servidor Node| ---- |   OpenAI API    |
|                 |      | (API REST, Streams)  |      | (app.js / Ngrok)|      | (Realtime / GPT)|
+-----------------+      +----------------------+      +-----------------+      +-----------------+
       ^      | Llamada                 ^       | WebSocket        ^      | WebSocket        ^
       |      | Teléfono                | Audio | Conexión         | Audio| Conexión         | Audio
       | Audio|                         |       | (wss://...)      |      | (wss://...)      | Texto
       +------+-------------------------+-------+------------------+------+------------------+
```

1.  **Inicio:** Tú (o un sistema externo) envías una petición HTTP POST a tu servidor Node (`/make-call`) con el número de teléfono a llamar y tu URL pública (ngrok).
2.  **Llamada Twilio:** Tu servidor usa la API REST de Twilio para decirle a Twilio que llame a ese número. Le proporciona TwiML que instruye a Twilio para que, al contestar, se conecte a la URL WebSocket de tu servidor (`wss://tu-url-ngrok/media-stream`).
3.  **Conexión WebSocket (Twilio <-> Servidor):** Twilio establece una conexión WebSocket con tu servidor.
4.  **Conexión WebSocket (Servidor <-> OpenAI):** Tu servidor, al recibir la conexión de Twilio, establece otra conexión WebSocket con la API Realtime de OpenAI, enviando la configuración inicial (incluyendo las instrucciones procesadas del archivo `.txt`).
5.  **Flujo de Audio (Usuario -> IA):**
    *   La persona habla.
    *   Twilio captura el audio y lo envía como mensajes `media` a través del WebSocket a tu servidor.
    *   Tu servidor reenvía estos datos de audio (`payload`) al WebSocket de OpenAI.
6.  **Flujo de Audio (IA -> Usuario):**
    *   OpenAI procesa el audio entrante, genera una respuesta en texto y la convierte a audio.
    *   OpenAI envía fragmentos de este audio (`response.audio.delta`) a través del WebSocket a tu servidor.
    *   Tu servidor reenvía estos fragmentos, junto con mensajes `mark`, al WebSocket de Twilio.
    *   Twilio reproduce el audio recibido a la persona en la llamada.

## Requisitos Previos

Necesitarás lo siguiente antes de empezar:

1.  **Node.js:** Preferiblemente la versión LTS más reciente o superior (v18+). [Descargar Node.js](https://nodejs.org/)
2.  **npm:** Generalmente se instala junto con Node.js.
3.  **Cuenta de Twilio:** Necesitarás:
    *   Account SID
    *   Auth Token
    *   Un número de teléfono de Twilio con capacidad de voz.
    *   [Regístrate o inicia sesión en Twilio](https://www.twilio.com/console)
4.  **Cuenta de OpenAI:** Necesitarás una clave API.
    *   [Regístrate o inicia sesión en OpenAI](https://platform.openai.com/)
5.  **ngrok:** Una herramienta para exponer tu servidor local a Internet, necesario para que Twilio pueda conectarse a tu WebSocket.
    *   [Descargar ngrok](https://ngrok.com/download)

## Instalación

1.  **Clonar el Repositorio:**
    ```bash
    git clone <URL_DEL_REPOSITORIO>
    cd <NOMBRE_DEL_DIRECTORIO>
    ```
2.  **Instalar Dependencias:**
    ```bash
    npm install
    ```

## Configuración

1.  **Variables de Entorno (`.env`):**
    *   Crea un archivo llamado `.env` en la raíz del proyecto.
    *   Copia el contenido de `.env.example` (si existe) o añade las siguientes variables, reemplazando los valores con tus propias credenciales:
        ```dotenv
        OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
        TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
        TWILIO_AUTH_TOKEN=your_auth_token_here
        TWILIO_PHONE_NUMBER=+1xxxxxxxxxx # Tu número de teléfono de Twilio
        # PORT=5050 # Opcional, por defecto es 5050
        ```
2.  **Archivo de Instrucciones (`instructions.txt`):**
    *   Este archivo define quién es el asistente, qué debe hacer, su estilo de habla, restricciones y variables.
    *   El archivo `app.js` actualmente está configurado para leer `instructions.txt`. Puedes editar este archivo para cambiar el comportamiento de la IA.
    *   **Variables:** El archivo usa placeholders como `{{nombre_cliente}}`, `{{fecha_entrega}}`, etc. La función `loadPrecallData` en `app.js` reemplaza estos placeholders con datos *antes* de enviar las instrucciones a OpenAI. Actualmente usa datos de ejemplo codificados directamente en `loadPrecallData`. Puedes modificar esta función para obtener datos reales de una base de datos o API si lo necesitas.

## Uso

1.  **Iniciar ngrok:** Abre una terminal y expón el puerto en el que corre tu aplicación (por defecto 5050):
    ```bash
    ngrok http 5050
    ```
    Copia la URL pública que te da ngrok (algo como `https://xxxxx.ngrok-free.app`). Necesitarás el *hostname* (la parte sin `https://`, por ejemplo, `xxxxx.ngrok-free.app`).

2.  **Iniciar el Servidor:** Abre *otra* terminal en el directorio del proyecto y ejecuta:
    ```bash
    node app.js
    ```
    Deberías ver mensajes indicando que el servidor está escuchando y que las instrucciones se cargaron.

3.  **Realizar la Llamada (API Request):** Envía una petición HTTP POST al endpoint `/make-call` de tu servidor. Puedes usar herramientas como Postman, Insomnia o `curl`.

    **Ejemplo con `curl`:**
    (Asegúrate de reemplazar `<NUMERO_A_LLAMAR>`, `<TU_HOSTNAME_NGROK>` y `<PUERTO_SERVIDOR>` si no es 5050)

    ```bash
    curl -X POST http://localhost:<PUERTO_SERVIDOR>/make-call \
    -H "Content-Type: application/json" \
    -d '{
          "to": "<NUMERO_A_LLAMAR>",
          "publicHostname": "<TU_HOSTNAME_NGROK>"
        }'
    ```
    *   **`to`**: El número de teléfono al que quieres llamar (en formato E.164, ej: `+15551234567`).
    *   **`publicHostname`**: El hostname de ngrok que copiaste (ej: `xxxxx.ngrok-free.app`).

4.  **¡Conversa!** Tu teléfono debería sonar. Contesta la llamada, y después de un breve momento, deberías escuchar al asistente de IA iniciar la conversación según las instrucciones procesadas.

## Componentes Clave del Código

*   **`app.js`**: El archivo principal.
    *   Configura e inicia el servidor web Fastify.
    *   Define la ruta `/make-call` para iniciar llamadas con la API de Twilio.
    *   Define la ruta WebSocket `/media-stream` para manejar la conexión de Twilio.
    *   Dentro del manejador WebSocket:
        *   Establece la conexión con OpenAI Realtime API.
        *   Gestiona el estado de la conexión (Stream SID, timestamps, etc.).
        *   Envía la configuración y las instrucciones (leídas y procesadas) a OpenAI.
        *   Reenvía audio entre Twilio y OpenAI.
        *   Maneja eventos de inicio/fin de habla, errores y cierres de conexión.
    *   Carga las instrucciones desde `instructions.txt` al iniciar.
    *   Contiene la función `loadPrecallData` para reemplazar variables en las instrucciones.
*   **`instructions.txt`**: Archivo de texto plano que define el prompt del sistema para la IA (rol, contexto, pasos, estilo, variables, etc.).
*   **`.env`**: Archivo (que debes crear) para almacenar de forma segura tus credenciales de API y Twilio. **¡No subas este archivo a Git!**

## Features

- Uses Twilio for outbound phone calls
- Leverages OpenAI's GPT-4o Realtime API for natural conversations
- Streams audio bidirectionally between Twilio and OpenAI
- Context-aware conversation based on order details
- Call recording via Twilio

## Prerequisites

- Node.js v16+ installed
- Twilio account with API credentials
- OpenAI API key with access to GPT-4o Realtime API
- ngrok or similar for exposing your local server to the internet (for Twilio webhooks)

## Installation

1. Clone this repository
2. Install dependencies:
   ```
   npm install
   ```
3. Create a `.env` file at the root of the project with the following variables:
   ```
   OPENAI_API_KEY=your_openai_api_key
   TWILIO_ACCOUNT_SID=your_twilio_account_sid
   TWILIO_AUTH_TOKEN=your_twilio_auth_token
   PUBLIC_HOSTNAME=your_ngrok_hostname.ngrok-free.app
   TWILIO_PHONE_NUMBER_FROM=+1234567890
   TWILIO_PHONE_NUMBER_TO=+0987654321
   ```

## Running the Application

1. Start ngrok to expose your server:
   ```
   ngrok http 5050
   ```

2. Update your `.env` file with the ngrok hostname

3. Start the server:
   ```
   npm start
   ```

## Usage

Once the server is running, you can initiate a call by making a GET request to:

```
http://localhost:5050/make-call/ORDER_ID
```

Replace `ORDER_ID` with one of the mock order IDs (e.g., `ORD12345` or `ORD67890`).

The application will:
1. Fetch the order data (mocked in this demo)
2. Generate call-specific instructions for the AI assistant
3. Initiate an outbound call via Twilio
4. Connect the call to the AI assistant powered by OpenAI

## Customization

- Modify `instructions.txt` to change the AI assistant's behavior and script
- Add more mock orders in the `getOrderData` function in `app.js`
- Customize the voice by changing the `VOICE` constant in `app.js`

## Production Considerations

- Implement proper authentication for API endpoints
- Store credentials securely
- Connect to your actual order database instead of mock data
- Add monitoring and logging
- Implement retry mechanisms for failed calls
- Add webhook handlers for call status updates 