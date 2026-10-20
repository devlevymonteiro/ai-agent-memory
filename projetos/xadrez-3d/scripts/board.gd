extends Node3D

## Controlador da partida.
## Monta tabuleiro + peças, encaixa a câmera, traduz toque em seleção/movimento
## e delega validação ao ChessRules e controle de vez ao TurnManager.

signal square_selected(square: Square)
signal selection_cleared()
signal piece_selected(piece: Piece)
signal piece_moved(piece: Piece, from: Vector2i, to: Vector2i)
signal piece_captured(piece: Piece)
signal piece_promoted(piece: Piece, new_type: Piece.Type)
signal check(is_white: bool)
signal game_over(winner_is_white: bool, reason: String)

const RAY_LENGTH := 200.0
const TAP_MAX_DRAG := 14.0             # px: acima disso é arrasto (câmera), não toque
const BOARD_HALF := 4.0
const BOARD_HEIGHT := 2.0              # altura máxima ocupada pelas peças
const FIT_PADDING := 1.08
const MIN_CAMERA_DISTANCE := 6.0
const CAMERA_DIR := Vector3(0.0, 0.92, 0.78)  # ~50 graus de inclinação
const FALLBACK_ASPECT := 16.0 / 9.0
const MOVE_DURATION := 0.22
const CAPTURE_DURATION := 0.18

const LAYER_SQUARES := 1
const LAYER_PIECES := 2
const PICK_MASK := LAYER_SQUARES | LAYER_PIECES

const BACK_RANK := [
	Piece.Type.ROOK, Piece.Type.KNIGHT, Piece.Type.BISHOP, Piece.Type.QUEEN,
	Piece.Type.KING, Piece.Type.BISHOP, Piece.Type.KNIGHT, Piece.Type.ROOK,
]

@export var camera_path: NodePath = ^"Camera3D"
@export var squares_path: NodePath = ^"Squares"
@export var pieces_path: NodePath = ^"Pieces"

@onready var camera: Camera3D = get_node(camera_path) as Camera3D
@onready var squares_root: Node3D = get_node(squares_path) as Node3D

var pieces_root: Node3D
var squares: Array[Square] = []
var pieces: Dictionary = {}            # Vector2i -> Piece (só casas ocupadas)
var turn_manager := TurnManager.new()

var selected_piece: Piece = null
var legal_targets: Array[Vector2i] = []
var is_animating := false
var game_state: ChessRules.Status = ChessRules.Status.ONGOING
var is_game_over := false

var _pending_promotion: Piece = null

var _press_position := Vector2.ZERO
var _pick_requested := false
var _pick_point := Vector2.ZERO


func _ready() -> void:
	squares = BoardBuilder.build(squares_root)
	pieces_root = get_node_or_null(pieces_path) as Node3D
	if pieces_root == null:
		pieces_root = Node3D.new()
		pieces_root.name = "Pieces"
		add_child(pieces_root)

	turn_manager.turn_changed.connect(_on_turn_changed)
	_spawn_starting_position()
	_fit_camera()
	get_viewport().size_changed.connect(_fit_camera)


# ---------------------------------------------------------------- input ----

func _unhandled_input(event: InputEvent) -> void:
	var consumed := false

	if event is InputEventScreenTouch:
		if event.index != 0:
			return
		if event.pressed:
			_press_position = event.position
		else:
			consumed = _request_pick(event.position)

	elif event is InputEventMouseButton:
		if event.button_index != MOUSE_BUTTON_LEFT:
			return
		if event.pressed:
			_press_position = event.position
		else:
			consumed = _request_pick(event.position)

	if consumed:
		get_viewport().set_input_as_handled()


func _request_pick(release_position: Vector2) -> bool:
	if release_position.distance_to(_press_position) > TAP_MAX_DRAG:
		return false  # arrasto: reservado para orbitar a câmera

	_pick_point = _press_position
	_pick_requested = true
	return true


## intersect_ray() consulta o espaço de física, que pode estar travado fora do
## passo de física. Resolver aqui elimina o risco de estado obsoleto.
func _physics_process(_delta: float) -> void:
	if not _pick_requested:
		return

	_pick_requested = false
	if is_animating or is_game_over:
		return

	_on_picked(raycast_pickable(_pick_point))


# -------------------------------------------------------------- raycast ----

## Devolve a Piece ou a Square mais próxima sob o ponto da tela.
func raycast_pickable(screen_point: Vector2) -> Node:
	if camera == null:
		return null

	var space := get_world_3d().direct_space_state
	if space == null:
		return null

	var origin := camera.project_ray_origin(screen_point)
	var normal := camera.project_ray_normal(screen_point)

	var query := PhysicsRayQueryParameters3D.create(origin, origin + normal * RAY_LENGTH)
	query.collision_mask = PICK_MASK
	query.collide_with_bodies = true
	query.collide_with_areas = false

	var hit := space.intersect_ray(query)
	if hit.is_empty():
		return null

	var body := hit["collider"] as Node
	if body == null:
		return null
	if body is Piece or body is Square:
		return body

	# volumes de pick das peças são filhos diretos de Piece
	var parent := body.get_parent()
	if parent is Piece:
		return parent
	return null


## Alternativa sem física para superfície plana: interseção analítica com o
## plano do topo das casas. O(1), mais barato, ignora peças.
func raycast_square_by_plane(screen_point: Vector2) -> Square:
	if camera == null:
		return null

	var origin := camera.project_ray_origin(screen_point)
	var normal := camera.project_ray_normal(screen_point)
	var plane := Plane(Vector3.UP, Square.THICKNESS * 0.5)

	var hit: Variant = plane.intersects_ray(origin, normal)
	if hit == null:
		return null

	var point := hit as Vector3
	var file := int(floor(point.x / Square.SIZE + 4.0))
	var rank := int(floor(point.z / Square.SIZE + 4.0))
	return square_at(file, rank)


# ------------------------------------------------------------- seleção -----

func _on_picked(node: Node) -> void:
	if node == null:
		clear_selection()
		return

	if node is Piece:
		var piece := node as Piece
		# clicar numa peça inimiga que é alvo válido = executar a captura
		if selected_piece != null and legal_targets.has(piece.coord) \
				and piece.is_white != selected_piece.is_white:
			execute_move(selected_piece, piece.coord)
			return
		if turn_manager.can_move(piece.is_white):
			select_piece(piece)
		else:
			clear_selection()
		return

	if node is Square:
		var square := node as Square
		if selected_piece != null and legal_targets.has(square.coord):
			execute_move(selected_piece, square.coord)
			return
		clear_selection()


func select_piece(piece: Piece) -> void:
	clear_selection()

	selected_piece = piece
	piece.set_highlighted(true)
	# legal_moves(), não valid_moves(): destinos que deixam o rei em xeque
	# não podem ser oferecidos ao jogador.
	legal_targets = ChessRules.legal_moves(piece.coord, pieces)

	for target in legal_targets:
		var square := square_at(target.x, target.y)
		if square == null:
			continue
		var victim := pieces.get(target)
		square.set_highlight(
			Square.Highlight.CAPTURE if victim != null else Square.Highlight.MOVE
		)

	piece_selected.emit(piece)
	if OS.is_debug_build():
		print("[board] %s selecionada — %d destinos" % [piece.name, legal_targets.size()])


func clear_selection() -> void:
	if selected_piece != null and is_instance_valid(selected_piece):
		selected_piece.set_highlighted(false)
	selected_piece = null

	for target in legal_targets:
		var square := square_at(target.x, target.y)
		if square != null and is_instance_valid(square):
			square.set_highlight(Square.Highlight.NONE)
	legal_targets.clear()

	selection_cleared.emit()


# ------------------------------------------------------------- jogadas -----

func execute_move(piece: Piece, to: Vector2i) -> void:
	if piece == null:
		return

	# Guarda definitiva: revalida contra as regras, não contra o cache de
	# destaque. Nenhuma chamada programática (IA, replay, undo) consegue
	# executar um lance que deixe o próprio rei em xeque.
	if not ChessRules.legal_moves(piece.coord, pieces).has(to):
		push_warning("[board] jogada ilegal bloqueada: %s -> %s" % [
			piece.algebraic(), ChessRules.algebraic(to)
		])
		return

	var from := piece.coord
	var captured := pieces.get(to) as Piece

	# estado lógico primeiro: a animação nunca pode deixar o tabuleiro inconsistente
	pieces.erase(from)
	if captured != null:
		pieces.erase(to)
	pieces[to] = piece

	turn_manager.record(from, to, piece, captured)
	clear_selection()

	piece.has_moved = true
	piece.place_at(to, true)
	piece_moved.emit(piece, from, to)

	if captured != null:
		_capture(captured)
		piece_captured.emit(captured)

	if ChessRules.needs_promotion(piece.type, piece.is_white, to):
		_pending_promotion = piece

	if OS.is_debug_build():
		print("[board] ", turn_manager.last_move_notation())

	# trava o input até a animação terminar; só então passa a vez
	is_animating = true
	var tween := create_tween()
	tween.tween_interval(MOVE_DURATION)
	tween.tween_callback(_on_move_finished)


func _on_move_finished() -> void:
	# promove antes de passar a vez: a peça nova muda a avaliação de xeque
	if _pending_promotion != null:
		_promote(_pending_promotion)
		_pending_promotion = null

	is_animating = false
	turn_manager.end_turn()
	_evaluate_game_state()


func _promote(piece: Piece) -> void:
	var new_type := ChessRules.promotion_choice(piece.is_white)
	piece.set_type(new_type)
	piece_promoted.emit(piece, new_type)

	if OS.is_debug_build():
		print("[board] promoção em %s -> %s" % [
			piece.algebraic(), Piece.TYPE_NAMES[new_type]
		])


## Chamado depois de cada jogada concluída, com a vez já trocada.
func _evaluate_game_state() -> void:
	game_state = ChessRules.status(turn_manager.is_white_turn, pieces)
	var label := ChessRules.status_label(game_state)

	match game_state:
		ChessRules.Status.CHECK:
			if OS.is_debug_build():
				print("[board] ", label, " — rei ",
					"branco" if turn_manager.is_white_turn else "preto")
			check.emit(turn_manager.is_white_turn)

		ChessRules.Status.CHECKMATE:
			var winner_is_white := not turn_manager.is_white_turn
			is_game_over = true
			turn_manager.finish()
			clear_selection()
			if OS.is_debug_build():
				print("[board] ", label, " — vitória das ",
					"brancas" if winner_is_white else "pretas")
			game_over.emit(winner_is_white, label)

		ChessRules.Status.STALEMATE:
			is_game_over = true
			turn_manager.finish()
			clear_selection()
			if OS.is_debug_build():
				print("[board] ", label)
			game_over.emit(false, label)

		_:
			pass


## Recomeça a partida sem recarregar a cena.
func reset_game() -> void:
	clear_selection()
	for coord in pieces.keys():
		var piece := pieces[coord] as Piece
		if piece != null and is_instance_valid(piece):
			piece.queue_free()
	pieces.clear()

	is_game_over = false
	game_state = ChessRules.Status.ONGOING
	turn_manager.reset()
	_spawn_starting_position()


func _capture(captured: Piece) -> void:
	captured.disable_pick()

	var tween := captured.create_tween()
	tween.set_parallel(true)
	tween.tween_property(captured, "scale", Vector3.ONE * 0.01, CAPTURE_DURATION)
	tween.tween_property(captured, "position:y", captured.position.y + 0.55, CAPTURE_DURATION)
	tween.chain().tween_callback(captured.queue_free)


# -------------------------------------------------------------- consulta ---

func square_at(file: int, rank: int) -> Square:
	if file < 0 or file > 7 or rank < 0 or rank > 7:
		return null
	return squares[rank * 8 + file]


func piece_at(coord: Vector2i) -> Piece:
	return pieces.get(coord) as Piece


func _on_turn_changed(is_white: bool) -> void:
	if OS.is_debug_build():
		print("[board] vez das ", "brancas" if is_white else "pretas")


# ---------------------------------------------------------- posição inicial -

func _spawn_starting_position() -> void:
	for file in 8:
		_spawn(BACK_RANK[file], true, Vector2i(file, 7))   # brancas: rank 1
		_spawn(Piece.Type.PAWN, true, Vector2i(file, 6))
		_spawn(BACK_RANK[file], false, Vector2i(file, 0))  # pretas: rank 8
		_spawn(Piece.Type.PAWN, false, Vector2i(file, 1))


func _spawn(type: Piece.Type, is_white: bool, at: Vector2i) -> void:
	var piece := Piece.new()
	pieces_root.add_child(piece)
	piece.setup(type, is_white, at)
	pieces[at] = piece


# ------------------------------------------------------------- câmera ------

## Encaixa a câmera projetando as 8 quinas do volume do tabuleiro no espaço da
## câmera. Como a orientação é fixa, x/y em espaço de câmera não dependem da
## distância -> a distância mínima sai em O(1), sem iteração.
func _fit_camera() -> void:
	if camera == null:
		return

	var viewport := get_viewport()
	var size := Vector2(viewport.size)
	var aspect := FALLBACK_ASPECT
	if size.x > 0.0 and size.y > 0.0:
		aspect = size.x / size.y

	var tan_v := tan(deg_to_rad(camera.fov) * 0.5)
	var tan_h := tan_v * aspect

	var dir := CAMERA_DIR.normalized()
	var basis := Basis().looking_at(-dir, Vector3.UP)
	var to_camera := basis.inverse()  # rotação mundo -> câmera

	var half := BOARD_HALF * FIT_PADDING
	var corners: Array[Vector3] = [
		Vector3(-half, 0.0, -half), Vector3(half, 0.0, -half),
		Vector3(half, 0.0, half), Vector3(-half, 0.0, half),
		Vector3(-half, BOARD_HEIGHT, -half), Vector3(half, BOARD_HEIGHT, -half),
		Vector3(half, BOARD_HEIGHT, half), Vector3(-half, BOARD_HEIGHT, half),
	]

	var distance := MIN_CAMERA_DISTANCE
	for corner in corners:
		var local := to_camera * corner
		# profundidade = distance - local.z, e precisa ser >= |x|/tan_h e >= |y|/tan_v
		distance = maxf(distance, absf(local.x) / tan_h + local.z)
		distance = maxf(distance, absf(local.y) / tan_v + local.z)

	camera.global_transform = Transform3D(basis, dir * distance)
	camera.near = maxf(0.05, distance * 0.02)
	camera.far = distance * 4.0
