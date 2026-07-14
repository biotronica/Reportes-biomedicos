// Datos extraídos de las plantillas F-01-P-SM01 de la carpeta de Drive de Intelmedica.
// Cada equipo trae su checklist de "Descripción de los procedimientos realizados" tal como
// aparece en la plantilla original. Si agregas más plantillas en Drive, simplemente añade
// una entrada nueva aquí siguiendo el mismo formato.

const EQUIPOS_DATA = {
  "Báscula Análoga": [
    "Revisión del correcto estado físico de platinas distribuidoras de peso.",
    "Revisión del correcto estado físico y operativo de sistema puesta cero.",
    "Revisión de condición física del disco graduado.",
    "Revisión del correcto estado físico y operativo de resorte encargado de giro aguja.",
    "Revisión de condición física y operativa del sistema mecánico.",
    "Pruebas de correcto funcionamiento al aplicar peso en ella.",
    "Revisión de integridad de estructura."
  ],
  "Báscula Digital": [
    "Revisión de funcionamiento individual de galgas de presión",
    "Comprobación de correcto funcionamiento de display",
    "Revisión de conexiones eléctricas y función de auto encendido.",
    "Comprobación de funcionamiento de pulsador de cambio de unidades.",
    "Revisión de compartimento de baterías.",
    "Pruebas de funcionamiento general."
  ],
  "Báscula Industrial": [
    "Revisión de funcionamiento de galga de presión",
    "Comprobación de correcto funcionamiento de display",
    "Revisión de conexiones eléctricas y función de auto encendido.",
    "Comprobación de funcionamiento de pulsador de cambio de unidades.",
    "Revisión de compartimento de baterías.",
    "Pruebas de funcionamiento general."
  ],
  "CPAP": [
    "Inspección de condición física de circuito neumático interno.",
    "Revisión de de condición física de botones de control.",
    "Revisión de condición física de tarjeta electrónica.",
    "Pruebas de funcionamiento de turbina.",
    "Revision de conexiones eléctricas.",
    "Revisión de conector salida de aire.",
    "Revisión de filtro de entrada de aire.",
    "Revisión de espumas internas.",
    "Revisión y limpieza de circuito respiratorio."
  ],
  "Tanque Hydrocollator": [
    "Comprobación de buen estado de estructura física",
    "Revisión de conexiones eléctricas",
    "Comprobación de funcionamiento del termostato",
    "Revisión de condición física y funcional de la resistencia",
    "Pruebas de funcionamiento general"
  ],
  "Desfibrilador": [
    "Comprobación de correcta lectura de ecg.",
    "Comprobación de detección de onda QRS y de arritmias.",
    "Pruebas de funcionamiento e integridad de mandos de control.",
    "Revisión de correcto funcionamiento de pantalla.",
    "Pruebas de detección de palas y parches de desfibrilación.",
    "Pruebas de continuidad en cable ecg, parches y palas.",
    "Prueba de autonomía de batería.",
    "Test de funcionamiento general.",
    "Mediciones cuantitativas con analizador de desfibrilación."
  ],
  "Calentador Eléctrico": [
    "Revisión de integridad física de estructura.",
    "Limpieza de filtro",
    "Revisión de mecanísmo de encendido.",
    "Revisión de teclado y pantalla",
    "Revisión de correcto funcionamiento de aumento y disminución de temperatura"
  ],
  "Pulsioxímetro": [
    "Comprobación de funcionamiento de pantalla.",
    "Comprobación de correcto funcionamiento de pulsador de control.",
    "Revisión de correcto estado de mecanismo de cierre.",
    "Lectura de voltaje de baterías.",
    "Revisión de correcto funcionamiento de las opciones del menú",
    "Pruebas de funcionamiento general"
  ],
  "Espirómetro": [
    "Comprobación de funcionamiento de display.",
    "Revisión de condición física y operativa del teclado.",
    "Revisión de condición física y operativa de la turbina.",
    "Limpieza de turbina.",
    "Revisión de cable USB.",
    "Lectura de voltaje de pila.",
    "Verificación de lectura de flujo en display utilizando una jeringa patrón.",
    "Verificación de correctas funciones de operación."
  ],
  "Termohigrómetro análogo": [
    "Revisión de condición física y operativa de las agujas y su mecanismo.",
    "Revisión de condición física de cristal y tablero de mediciones.",
    "Revisión de condición física de carcasa.",
    "Comprobación de lectura de temperatura y humedad."
  ],
  "Máquina de anestesia": [
    "Revisión de funcionamiento de botones y mando de control",
    "Revisión de funcionamiento de alarmas sonoras y visuales",
    "Pruebas de fugas en modo de ventilación mecánica y ventilación manual",
    "Ajuste de sensor de oxígeno al 21% y al 100%",
    "Revisión de funcionamiento de caudalímetros",
    "Revisión de indicador de manómetros de presión",
    "Limpieza general del equipo",
    "Pruebas de ciclado del ventilador y lectura de parámetros con equipo patrón"
  ],
  "Tensiómetro Mercurio": [
    "Limpieza de mangueras",
    "Limpieza de brazaletes",
    "Limpieza de tubo contenedor de mercurio",
    "Revisión de funcionamiento de manómetro",
    "Revisión de funcionamiento de pera",
    "Revisión de correcto desplazamiento de mercurio",
    "Pruebas de funcionamiento general"
  ],
  "Tensiómetro Digital": [
    "Revisión de correcto estado de brazaletes y mangueras.",
    "Lectura de voltaje de baterías de alimentación.",
    "Revisión de contactos de batería.",
    "Revisión de conexiones eléctricas.",
    "Revisión de funcionamiento de pulsadores de control.",
    "Revisión de funcionamiento de pantalla",
    "Pruebas de fugas.",
    "Pruebas de funcionamiento general."
  ],
  "Equipo de órganos": [
    "Limpieza de contactos de compartimento de baterías de otoscopio y oftalmoscopio.",
    "Comprobación de funcionamiento de reguladores de enfoque y lentes en oftalmoscopio.",
    "Comprobación de encendido de luces con interruptor.",
    "Comprobación estado de baterías.",
    "Comprobación de funcionamiento de mecanismo de encendido.",
    "Revisión y limpieza de contactos de bombillos."
  ],
  "Micromotor": [
    "Revisión de tarjeta controladora de velocidad.",
    "Revisión de condición operativa de suiches.",
    "Revisión de cable micromotor.",
    "Revisión de condición física y operativa del pedal.",
    "Revisión y limpieza de carcasa.",
    "Cambio de rodamientos de punta micromotor.",
    "Verificación de correcta operación del equipo."
  ],
  "Termómetro Digital Nevera": [
    "Comprobación funcionamiento de display.",
    "Comprobación de lectura de temperatura.",
    "Comprobación de funcionamiento de mandos de control.",
    "Revisión de cable sonda temperatura."
  ],
  "Termómetro Infrarrojo": [
    "Comprobación de funcionamiento de display.",
    "Comprobación de correcto funcionamiento de cambio unidades.",
    "Limpieza de contacto de baterías.",
    "Revisión de estado de batería.",
    "Pruebas de funcionamiento.",
    "Lectura de voltaje de pila.",
    "Limpieza de led infrarrojo."
  ],
  "Nebulizador": [
    "Inspección de condición física de circuito neumático interno.",
    "Revisión de interruptor de encendido.",
    "Pruebas de funcionamiento de compresor interno.",
    "Revision de conexiones eléctricas.",
    "Revisión de conector salida de aire.",
    "Revisión de filtro de entrada de aire."
  ],
  "Neopuff": [
    "Revisión de conexión de entrada de oxígeno",
    "Comprobación de correcta salida de oxígeno",
    "Comprobación de funcionamiento de reguladores de presión.",
    "Revisión de circuito neumático interior."
  ],
  "Lámpara cialítica": [
    "Revisión de integridad física de estructura.",
    "Lubricación de articulaciones.",
    "Revisión de mecanísmo de encendido.",
    "Revisión de sistema eléctrico.",
    "Revisión de intensidad de luz."
  ],
  "Lámpara pielítica": [
    "Revisión de integridad física de estructura.",
    "Lubricación de articulaciones.",
    "Revisión de mecanísmo de encendido.",
    "Revisión de sistema eléctrico.",
    "Revisión de condición operativa de bombillería.",
    "Revisión de condición operativa de enfoque luz."
  ],
  "Lámpara cuello de cisne": [
    "Se verifica el estado físico del equipo",
    "Revisión de condición física y operativa del sistema eléctrico.",
    "Se verifica el sistema de encendido y apagado del equipo",
    "Se verifica el buen funcionamiento de la lámpara.",
    "Pruebas de funcionamiento general"
  ],
  "Lámpara infrarroja": [
    "Revisión de condición física del cable AC.",
    "Revisión de suiche selector de funciones.",
    "Revisión de leds infrarrojo.",
    "Verificación de activación de motor vibrador.",
    "Revisión de condición física de carcasa."
  ],
  "Tallímetro (cinta métrica)": [
    "Se verifica la correcta posición vertical.",
    "Se verifica el correcto estado del mecanismo de retracción.",
    "Se verifica el correcto estado de la impresión de la escala.",
    "Se verifica la condición física de la base del tallímetro.",
    "Se verifica la condición física del visor.",
    "Se verifica la condición física de la cinta de medida."
  ],
  "Autoclave de vapor para odontología": [
    "Comprobación de correcto funcionamiento.",
    "Revisión sistema de tuberías",
    "Revisión sistema eléctrico, resistencias y termostato",
    "Revisión de funcionamiento de manómetro de presión.",
    "Comprobación de autonomía de batería",
    "Revisión de funcionamiento de pilotos",
    "Revisión de operación de válvula solenoide llenado de agua y evacuación.",
    "Revisión de puerta y empaque de sellado",
    "Comprobación de control de presión y temperatura programada.",
    "Revisión de funcionamiento de timer"
  ],
  "Gramera": [
    "Se verifica correcto funcionamiento de display",
    "Se verifica estado físico del equipo",
    "Se verifica el estado físico de la bandeja",
    "Se verifica correcto funcionamiento de modos de pesaje (unidades)",
    "Se realizan pruebas de funcionamiento general"
  ],
  "Alcoholímetro": [
    "Revisión de condición física y operativa de teclado y display.",
    "Verificación de lectura al exhalar en él.",
    "Revisión de conducto de medición.",
    "Revisión de condición física de boquillas"
  ],
  "Electrobisturí": [
    "Verificación de condición física y operativa de panel de control (suiches y displays).",
    "Verificación de condición física y operativa de conectores para electrodos y pedales.",
    "Verificación de condición física y operativa de pedal monopolar y pedal bipolar.",
    "Limpieza de ventiladores y tarjetas electrónicas.",
    "Verificación de activación de alarma por no detección de placa dispersiva.",
    "Revisión de conexiones eléctricas internas.",
    "Lectura de potencia monopolar y bipolar entregada por el equipo con analizador de potencia.",
    "Limpieza general."
  ],
  "Otro / personalizado": []
};

// Lista ordenada alfabéticamente para el selector
const EQUIPOS_LISTA = Object.keys(EQUIPOS_DATA).sort((a, b) => a.localeCompare(b, 'es'));

// IDs reales de los archivos de plantilla en Drive (carpeta "Formatos Mantenimientos
// Preventivos" dentro de MANTENIMIENTOS), uno por tipo de equipo. Se usan para descargar
// la plantilla oficial exacta y llenarla, en vez de recrearla desde cero.
const TEMPLATE_FILE_IDS = {
  "Báscula Análoga": "1VzEQWfMuLNxl6nWavQ2DlNZDg0aERAIH",
  "Báscula Digital": "1EkX9EZkafhhA4czRMQSyLrEBROL_Eu3I",
  "Báscula Industrial": "1H28qajSyYvlQVNEqTmyjFP48fWe3o0kh",
  "CPAP": "1CPWhYZKlaUBXHsd35c8OxCOLolEDVjWK",
  "Tanque Hydrocollator": "1WEbRcd8BJEutMxmFlg6k-FoMV6xCaOmt",
  "Desfibrilador": "1rHJTwR2K5eH4UtPg_MDhPKkR_QZjezcw",
  "Calentador Eléctrico": "1mfAjVzQLqODn4HNQc_-bD2jTEx4WVzma",
  "Pulsioxímetro": "1KpMJFEw-ikn8XkJ5KpRnYXIVT8W4w5-c",
  "Espirómetro": "106XWw_CYGbzTOZ_KluvXRghOL1W7HtlH",
  "Termohigrómetro análogo": "1sJFJjZt0q3_WVZlcE8iDEOyhjmZg90j_",
  "Máquina de anestesia": "1UrZCyPk7B7WG21QldgGWL9w-wJsRrbNL",
  "Tensiómetro Mercurio": "1K15HSK6oWQ63kxTkpgFUn543x6BW0CTy",
  "Equipo de órganos": "1m7Qib89iYcDZyEyywadZEPBhGzvpEsuH",
  "Micromotor": "1bQlMWfZ0sDVQE_ouu9lGVKr2poHYtins",
  "Termómetro Digital Nevera": "11RlE6Q_dxfCP-B3qJFBBGgj-CQXOhUEH",
  "Nebulizador": "1BJSyh9bSFKi09ONkkJYa1BdXdT5aylHg",
  "Termómetro Infrarrojo": "1pVW-gReStgCFgkfyz7L-iaLjf58vXLZt",
  "Neopuff": "1mj2YAdtI0hd5Q0cRlg3PN0Pw0Fzblon2",
  "Lámpara cialítica": "1u0__Lx-QqmD31n4VRqZDKwWsd8l44-jf",
  "Lámpara pielítica": "1C09cfm0NXa1JoZdwGxH6Flvqny4kYaYs",
  "Tensiómetro Digital": "1830I1gkTmzuxNaNAMHNnm0uGjR3MQVCe",
  "Tallímetro (cinta métrica)": "1bjd4WLdCr6IFHJ4Nc9r1kq2yWbPNHZGD",
  "Lámpara cuello de cisne": "1JPomzc0KrrBsBV_omgjPsnPb7rIm5YAs",
  "Autoclave de vapor para odontología": "1oEYkluwS1-EfhP30SOm3euqGjfd9yWoj",
  "Gramera": "152F6gZDZ2qOD_-xrLnNZcLxifL5Do0WH",
  "Alcoholímetro": "1bU4X__RmlaZIml2koKEVOnJuyLwAxrrf",
  "Electrobisturí": "1xCFhn6qaPhzHJuUrO8ovDqpocApwVQhD",
  "Lámpara infrarroja": "16ncsfdHjwGhb6dJmft9C3hrPhyMyASy2"
};
