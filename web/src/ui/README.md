# Componentes de interfaz

Los componentes de esta carpeta usan los tokens de `src/styles/tokens.css` y los estilos compartidos de `components.css`. Reciben atributos HTML estándar cuando corresponde; los ejemplos suponen React y TypeScript.

## Button

Variantes `primary`, `secondary`, `ghost` y `danger`; tamaños `sm`, `md` y `lg`. `loading` deshabilita el control y anuncia el estado ocupado. `iconLeft` y `iconRight` reciben contenido React.

```tsx
<Button variant="primary" loading={saving} iconRight={<ArrowIcon />}>
  Guardar cambios
</Button>
```

## Input y PasswordInput

`Input` acepta `label`, `hint` y `error`; relaciona el texto con el campo mediante `aria-describedby` y expone errores con `aria-invalid`. `PasswordInput` agrega el control mostrar/ocultar con `aria-pressed`.

```tsx
<Input label="Correo" type="email" autoComplete="email" error={emailError} />
<PasswordInput label="Contraseña" autoComplete="current-password" />
```

## Card

Contenedor semántico que admite `header`, `footer`, `className` y atributos `section`.

```tsx
<Card header={<h2>Uso</h2>} footer={<a href="/console/keys">Ver claves</a>}>
  <p>Resumen del espacio de trabajo.</p>
</Card>
```

## Badge

Tonos `neutral`, `success`, `warning`, `danger` e `info`. `dot` agrega un indicador decorativo.

```tsx
<Badge tone="success" dot>Activa</Badge>
```

## Modal

Controlado por `open`; recibe `title`, `description`, `onClose` y `children`. Al abrir mueve el foco al diálogo, mantiene la navegación con Tab, cierra con Escape y devuelve el foco al elemento anterior.

```tsx
<Modal open={open} title="Revocar clave" description="La app perderá acceso." onClose={close}>
  <Button variant="danger" onClick={revoke}>Revocar</Button>
</Modal>
```

## Toast

Recibe `tone` (`success`, `error`, `warning` o `info`), `title`, una `description` opcional y `onClose`. Se cierra automáticamente a los 4,5 segundos cuando se proporciona `onClose`.

```tsx
<Toast tone="success" title="Cambios guardados" onClose={dismiss} />
```
