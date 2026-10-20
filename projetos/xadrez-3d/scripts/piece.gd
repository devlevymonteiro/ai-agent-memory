class_name Piece
extends Node3D

## Peça do tabuleiro. Envolve o modelo 3D (asset ou fallback) e cuida de
## posicionamento, orientação por cor e volume de seleção.

const PICK_LAYER := 2  # bit 1 -> "pieces" (ver layer_names no project.godot)
const PICK_HEIGHT := 1.2

enum Type { PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING }

const TYPE_NAMES := {
	Type.PAWN: &"pawn",
	Type.KNIGHT: &"knight",
	Type.BISHOP: &"bishop",
	Type.ROOK: &"rook",
	Type.QUEEN: &"queen",
	Type.KING: &"king",
}

## Loader compartilhado entre as 32 peças: indexa a pasta uma única vez.
static var _loader: PieceModelLoader

var type: Type = Type.PAWN
var is_white := true
var coord := Vector2i.ZERO
var has_moved := false
var is_highlighted := false

var _model: Node3D
var _pick: StaticBody3D


func _ready() -> void:
	add_to_group("pieces")


func setup(p_type: Type, p_is_white: bool, p_coord: Vector2i) -> void:
	type = p_type
	is_white = p_is_white
	coord = p_coord
	name = ("w" if is_white else "b") + "_" + TYPE_NAMES[type] + "_" + algebraic()

	if _loader == null:
		_loader = PieceModelLoader.new()
		if OS.is_debug_build():
			_loader.debug_report()

	_model = _loader.create_piece(TYPE_NAMES[type], is_white)
	_model.name = "Model"
	add_child(_model)

	# Pretas encaram o lado oposto do tabuleiro.
	# A rotação vive no modelo, não na peça: assim `position` continua sendo
	# pura coordenada de tabuleiro e animações de Tween não brigam com ela.
	_model.rotation_degrees.y = 0.0 if is_white else 180.0

	_build_pick_volume()
	place_at(coord)


## Troca o tipo da peça in place (promoção). Reconstrói modelo e volume de
## pick preservando cor, coordenada, rotação e estado de destaque.
func set_type(p_type: Type) -> void:
	if p_type == type:
		return

	type = p_type
	name = ("w" if is_white else "b") + "_" + TYPE_NAMES[type] + "_" + algebraic()

	if _model != null and is_instance_valid(_model):
		_model.free()

	_model = _loader.create_piece(TYPE_NAMES[type], is_white)
	_model.name = "Model"
	_model.rotation_degrees.y = 0.0 if is_white else 180.0
	add_child(_model)

	if is_highlighted:
		is_highlighted = false
		set_highlighted(true)

	_build_pick_volume()


func place_at(p_coord: Vector2i, animated := false) -> void:
	coord = p_coord
	var target := Square.coord_to_world(p_coord)
	target.y = Square.THICKNESS * 0.5  # assenta sobre o topo da casa

	if not animated or not is_inside_tree():
		position = target
		return

	var tween := create_tween()
	tween.set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	tween.tween_property(self, "position", target, 0.22)


func set_highlighted(value: bool) -> void:
	if is_highlighted == value or _loader == null or _model == null:
		return
	is_highlighted = value
	_loader.apply_highlight(_model, value)


## Tira a peça do raycast. Chamado na captura, antes da animação de saída,
## para a peça morrendo não interceptar o próximo toque.
func disable_pick() -> void:
	if _pick == null or not is_instance_valid(_pick):
		return
	_pick.collision_layer = 0
	_pick.collision_mask = 0


func algebraic() -> String:
	return "abcdefgh"[coord.x] + str(8 - coord.y)


## Volume de colisão simples para seleção por raycast (sem física nas peças).
## Idempotente: pode ser chamado de novo depois de uma promoção.
func _build_pick_volume() -> void:
	if _pick != null and is_instance_valid(_pick):
		_pick.free()

	_pick = StaticBody3D.new()
	_pick.name = "Pick"
	_pick.collision_layer = PICK_LAYER
	_pick.collision_mask = 0

	var shape := CollisionShape3D.new()
	shape.name = "Shape"
	var box := BoxShape3D.new()
	var height: float = PieceModelLoader.TARGET_HEIGHT.get(TYPE_NAMES[type], 0.8)
	box.size = Vector3(0.9, maxf(height, PICK_HEIGHT), 0.9)
	shape.shape = box
	shape.position.y = box.size.y * 0.5
	_pick.add_child(shape)

	add_child(_pick)
